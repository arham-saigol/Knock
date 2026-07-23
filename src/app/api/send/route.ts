import "server-only";

import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import nodemailer from "nodemailer";
import { NextResponse } from "next/server";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export const runtime = "nodejs";
export const maxDuration = 120;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function mayHaveAcceptedMessage(error: unknown) {
  if (!error || typeof error !== "object") return true;
  const responseCode = "responseCode" in error ? error.responseCode : undefined;
  if (
    typeof responseCode === "number" &&
    responseCode >= 400 &&
    responseCode < 600
  )
    return false;
  const command = "command" in error ? error.command : undefined;
  if (typeof command === "string") {
    return command.trim().toUpperCase() === "DATA";
  }
  const code = "code" in error ? error.code : undefined;
  return !["EAUTH", "ECONNECTION", "EDNS", "ESOCKET", "ETLS"].includes(
    typeof code === "string" ? code.toUpperCase() : "",
  );
}

export async function POST(request: Request) {
  const { userId, getToken } = await auth();
  if (!userId)
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );

  let attemptId: Id<"deliveryAttempts"> | undefined;
  let client: ConvexHttpClient | undefined;
  let smtpStarted = false;
  try {
    const payload = (await request.json()) as { draftId?: Id<"drafts"> };
    if (!payload.draftId)
      return NextResponse.json(
        { error: "draftId is required" },
        { status: 400 },
      );
    const token = await getToken({ template: "convex" });
    if (!token) throw new Error("Unable to create a Convex session");
    client = new ConvexHttpClient(required("NEXT_PUBLIC_CONVEX_URL"));
    client.setAuth(token);
    const delivery = await client.mutation(api.deliveries.reserve, {
      draftId: payload.draftId,
    });
    attemptId = delivery.attemptId;

    const allowedSenders = required("SPACEMAIL_ALLOWED_SENDERS")
      .split(",")
      .map((sender) => sender.trim().toLowerCase())
      .filter(Boolean);
    if (!allowedSenders.includes(delivery.senderEmail.toLowerCase())) {
      throw new Error(
        "This project sender is not an authorized Spacemail alias",
      );
    }

    const port = Number(process.env.SPACEMAIL_SMTP_PORT ?? "465");
    const transporter = nodemailer.createTransport({
      host: required("SPACEMAIL_SMTP_HOST"),
      port,
      secure: port === 465,
      requireTLS: port !== 465,
      auth: {
        user: required("SPACEMAIL_SMTP_USER"),
        pass: required("SPACEMAIL_SMTP_PASSWORD"),
      },
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 45_000,
    });
    const senderDomain = delivery.senderEmail.split("@")[1];
    smtpStarted = true;
    const info = await transporter.sendMail({
      from: { name: delivery.senderName, address: delivery.senderEmail },
      envelope: { from: delivery.senderEmail, to: [delivery.recipientEmail] },
      to: delivery.recipientEmail,
      replyTo: delivery.senderEmail,
      subject: delivery.subject,
      text: delivery.body,
      messageId: `<knock-${payload.draftId}@${senderDomain}>`,
      headers: { "X-Entity-Ref-ID": `knock-${payload.draftId}` },
    });
    await client.mutation(api.deliveries.complete, {
      attemptId,
      providerMessageId: info.messageId,
    });
    return NextResponse.json({ sent: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to send email";
    if (attemptId && client) {
      const mutation =
        smtpStarted && mayHaveAcceptedMessage(error)
          ? client.mutation(api.deliveries.markUnknown, {
              attemptId,
              error: message,
            })
          : client.mutation(api.deliveries.fail, {
              attemptId,
              error: message,
            });
      await mutation.catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
