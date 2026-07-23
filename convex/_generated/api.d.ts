/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as deliveries from "../deliveries.js";
import type * as draftActions from "../draftActions.js";
import type * as draftData from "../draftData.js";
import type * as http from "../http.js";
import type * as launches from "../launches.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_deepseek from "../lib/deepseek.js";
import type * as lib_emailDiscovery from "../lib/emailDiscovery.js";
import type * as lib_firecrawl from "../lib/firecrawl.js";
import type * as lib_firecrawlWebhook from "../lib/firecrawlWebhook.js";
import type * as lib_productHunt from "../lib/productHunt.js";
import type * as lib_strings from "../lib/strings.js";
import type * as lib_time from "../lib/time.js";
import type * as lib_tinyfish from "../lib/tinyfish.js";
import type * as lib_urls from "../lib/urls.js";
import type * as monitoringActions from "../monitoringActions.js";
import type * as monitoringData from "../monitoringData.js";
import type * as projectActions from "../projectActions.js";
import type * as projects from "../projects.js";
import type * as researchActions from "../researchActions.js";
import type * as researchData from "../researchData.js";
import type * as schedules from "../schedules.js";
import type * as syncActions from "../syncActions.js";
import type * as syncData from "../syncData.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  deliveries: typeof deliveries;
  draftActions: typeof draftActions;
  draftData: typeof draftData;
  http: typeof http;
  launches: typeof launches;
  "lib/auth": typeof lib_auth;
  "lib/deepseek": typeof lib_deepseek;
  "lib/emailDiscovery": typeof lib_emailDiscovery;
  "lib/firecrawl": typeof lib_firecrawl;
  "lib/firecrawlWebhook": typeof lib_firecrawlWebhook;
  "lib/productHunt": typeof lib_productHunt;
  "lib/strings": typeof lib_strings;
  "lib/time": typeof lib_time;
  "lib/tinyfish": typeof lib_tinyfish;
  "lib/urls": typeof lib_urls;
  monitoringActions: typeof monitoringActions;
  monitoringData: typeof monitoringData;
  projectActions: typeof projectActions;
  projects: typeof projects;
  researchActions: typeof researchActions;
  researchData: typeof researchData;
  schedules: typeof schedules;
  syncActions: typeof syncActions;
  syncData: typeof syncData;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
