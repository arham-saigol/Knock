import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";
import { toJSONSchema, type ZodType } from "zod";

function getDeepSeekModel() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not configured");

  const deepseek = createOpenAICompatible({
    name: "deepseek",
    apiKey,
    baseURL: "https://api.deepseek.com",
    // DeepSeek supports JSON object mode, while AI SDK still validates the
    // parsed object against the supplied Zod schema.
    supportsStructuredOutputs: false,
    transformRequestBody: withDeepSeekThinking,
  });

  return deepseek("deepseek-v4-pro");
}

export function withDeepSeekThinking(body: Record<string, unknown>) {
  return {
    ...body,
    thinking: { type: "enabled" },
    reasoning_effort: "high",
  };
}

export async function generateDeepSeekObject<T>({
  schema,
  system,
  prompt,
  maxOutputTokens = 4_000,
}: {
  schema: ZodType<T>;
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}) {
  const jsonSchema = toJSONSchema(schema);
  const result = await generateText({
    model: getDeepSeekModel(),
    system: `${system}\nReturn only one valid JSON object. It must satisfy this JSON Schema exactly:\n${JSON.stringify(jsonSchema)}`,
    prompt: `${prompt}\n\nRespond with the JSON object only. Do not use Markdown fences or add commentary.`,
    output: Output.object({ schema }),
    maxOutputTokens,
    maxRetries: 1,
    timeout: 150_000,
  });
  return result.output;
}
