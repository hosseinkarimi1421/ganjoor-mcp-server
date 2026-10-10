/*
Ganjoor MCP — corrected payloads, version 1.0.1.
Ready to replace ganjoor-official-worker.mjs in the existing project.
All 44 tool implementations are included; no folders need to be uploaded for this update.
Rebuild from cloudflare-adapter.mjs and src/ with npm run build:worker.

MIT License

Copyright (c) 2026 Ganjoor

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

// cloudflare-adapter.mjs
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { httpServerHandler } from "cloudflare:node";

// dist/server.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// dist/constants.js
var API_BASE_URL = (process.env.GANJOOR_API_BASE_URL ?? "https://api.ganjoor.net").replace(/\/+$/, "");
var SITE_BASE_URL = (process.env.GANJOOR_SITE_BASE_URL ?? "https://ganjoor.net").replace(/\/+$/, "");
var REQUEST_TIMEOUT_MS = 3e4;
var MAX_PAGE_SIZE = 100;
var SERVER_NAME = "ganjoor-mcp-server";
var SERVER_VERSION = "1.0.1";
var SERVER_INSTRUCTIONS = `Ganjoor (\u06AF\u0646\u062C\u0648\u0631) is the largest public archive of Persian
classical poetry. This server exposes the read-only, public parts of the Ganjoor REST API
(https://api.ganjoor.net) for browsing poets, collections, poems, verses, prosody/rhyme
analysis, recitations, commentary, and related-people graphs.

Key ideas:
- "Poet" (\u0634\u0627\u0639\u0631) has an id and a URL slug, e.g. Hafez is poet id 2, slug "/hafez".
- "Category" (\u0628\u062E\u0634/\u062F\u06CC\u0648\u0627\u0646) groups poems inside a poet's work. Root category id for Hafez is 9.
- "Poem" (\u0634\u0639\u0631) has an id and a full URL such as "/hafez/ghazal/sh494".
- Poem text is Persian and right-to-left; return it verbatim, never transliterate or translate
  it unless the user explicitly asks.
- Nearly every tool accepts \`response_format\`: "markdown" (default, readable) or
  "json" (structured, for programmatic use).

Workflow tip: browse with ganjoor_list_poets / ganjoor_get_poet / ganjoor_get_category,
find a poem with ganjoor_search_poems, then read it with ganjoor_get_poem (by URL) or
ganjoor_get_poem_by_id.`;

// dist/tools/poets.js
import { z as z2 } from "zod";

// dist/client.js
var GanjoorApiError = class extends Error {
  status;
  endpoint;
  constructor(message, status, endpoint) {
    super(message);
    this.name = "GanjoorApiError";
    this.status = status;
    this.endpoint = endpoint;
  }
};
async function ganjoorGet(endpoint, params = {}) {
  const url = buildUrl(endpoint, params);
  return request(url, endpoint);
}
async function ganjoorPost(endpoint, body, params = {}) {
  const url = buildUrl(endpoint, params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    return await handleResponse(response, endpoint);
  } catch (error) {
    if (error instanceof GanjoorApiError)
      throw error;
    throw toTransportError(error, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}
function buildUrl(endpoint, params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === void 0 || value === null || value === "")
      continue;
    if (Array.isArray(value)) {
      for (const item of value)
        search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const query = search.toString();
  return `${API_BASE_URL}${endpoint}${query ? `?${query}` : ""}`;
}
async function request(url, endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal
    });
    return await handleResponse(response, endpoint);
  } catch (error) {
    if (error instanceof GanjoorApiError)
      throw error;
    throw toTransportError(error, endpoint);
  } finally {
    clearTimeout(timeout);
  }
}
async function handleResponse(response, endpoint) {
  const body = await response.text();
  if (!response.ok) {
    throw new GanjoorApiError(buildErrorMessage(response.status, body, endpoint), response.status, endpoint);
  }
  if (!body.trim())
    return [];
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
function buildErrorMessage(status, body, endpoint) {
  const detail = extractDetail(body);
  switch (status) {
    case 400:
      return `Error: bad request for ${endpoint}.${detail ? ` ${detail}` : ""} Check that ids and filters are valid.`;
    case 401:
    case 403:
      return `Error: access denied for ${endpoint}. This resource requires a logged-in Ganjoor account; only public read endpoints are available here.`;
    case 404:
      return `Error: not found at ${endpoint}. Verify the id or URL slug \u2014 use ganjoor_list_poets or ganjoor_search_poems to find valid ones.`;
    case 429:
      return "Error: rate limited by api.ganjoor.net. Wait a few seconds and retry, and reduce the request rate.";
    default:
      if (status >= 500) {
        return `Error: Ganjoor API server error (${status}) for ${endpoint}.${detail ? ` ${detail}` : ""} This is usually an upstream bug \u2014 try a related endpoint or retry later.`;
      }
      return `Error: request to ${endpoint} failed with status ${status}.${detail ? ` ${detail}` : ""}`;
  }
}
function extractDetail(body) {
  const trimmed = body.trim();
  if (!trimmed)
    return "";
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string")
      return truncate(parsed, 300);
    if (parsed && typeof parsed === "object") {
      const record = parsed;
      for (const key of ["title", "message", "error", "detail"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim())
          return truncate(value.trim(), 300);
      }
    }
  } catch {
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  if (/^System\.\w+Exception/.test(firstLine))
    return truncate(firstLine, 200);
  return truncate(firstLine, 300);
}
function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max)}\u2026` : value;
}
function toTransportError(error, endpoint) {
  if (error instanceof Error && error.name === "AbortError") {
    return new GanjoorApiError(`Error: request to ${endpoint} timed out after ${REQUEST_TIMEOUT_MS / 1e3}s. Retry, or narrow the request with pagination parameters.`, null, endpoint);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new GanjoorApiError(`Error: could not reach the Ganjoor API (${API_BASE_URL}) for ${endpoint}: ${message}. Check network connectivity and retry.`, null, endpoint);
}
function toActionableError(error) {
  if (error instanceof GanjoorApiError)
    return error.message;
  if (error instanceof Error)
    return `Error: ${error.message}`;
  return `Error: unexpected failure: ${String(error)}`;
}
async function fetchPaged(endpoint, page, pageSize, params = {}) {
  const start = (page - 1) * pageSize;
  const unpaged = endpoint === "/api/ganjoor/poets" || endpoint === "/api/ganjoor/rhythms";
  const response = await ganjoorGet(endpoint, {
    ...params,
    ...unpaged ? {} : { PageNumber: page, PageSize: pageSize }
  });
  const list = Array.isArray(response) ? response : [];
  const localPaging = unpaged || list.length > pageSize;
  const items = localPaging ? list.slice(start, start + pageSize) : list;
  let hasMore = localPaging ? start + items.length < list.length : false;
  if (!localPaging && items.length === pageSize) {
    const next = await ganjoorGet(endpoint, {
      ...params,
      PageNumber: page * pageSize + 1,
      PageSize: 1
    });
    hasMore = Array.isArray(next) && next.length > 0;
  }
  return {
    items,
    page,
    page_size: pageSize,
    has_more: hasMore,
    next_page: hasMore ? page + 1 : null,
    ...localPaging ? { total: list.length } : {}
  };
}

// dist/schemas.js
import { z } from "zod";
var ResponseFormat;
(function(ResponseFormat2) {
  ResponseFormat2["MARKDOWN"] = "markdown";
  ResponseFormat2["JSON"] = "json";
})(ResponseFormat || (ResponseFormat = {}));
var ResponseFormatSchema = z.nativeEnum(ResponseFormat).default(ResponseFormat.MARKDOWN).describe("Output format: 'markdown' for human-readable text (default) or 'json' for machine-readable structured data.");
var PaginationSchema = z.object({
  page: z.number().int().min(1).max(1e4).default(1).describe("Page number, starting from 1."),
  page_size: z.number().int().min(1).max(MAX_PAGE_SIZE).default(20).describe(`Maximum items to return per page (1-${MAX_PAGE_SIZE}, default 20).`)
});
var PageField = PaginationSchema.shape.page;
var PageSizeField = PaginationSchema.shape.page_size;
var UrlSlugSchema = z.string().trim().min(1, "URL must not be empty").max(300, "URL must not exceed 300 characters").regex(/^\/?[A-Za-z0-9آ-ی؀-ۿ‌._~%\-/]+$/u, "URL may only contain letters, digits, '-', '_', '.', '%', '/' and Persian characters").describe("Ganjoor URL slug. Examples: 'hafez/ghazal/sh494', '/hafez/ghazal/sh494', 'mowhaddam/ghazal/ha1'. The leading slash is optional.").transform((value) => `/${value.replace(/^\/+/, "")}`);
var IdSchema = z.number().int().positive("Id must be a positive integer").describe("Numeric Ganjoor record id (poet, category, poem, person, ...).");
var PoetIdSchema = z.number().int().min(0).default(0).describe("Poet id. Use 0 for 'all poets' where the endpoint supports it. Hafez is 2, Saadi is 7, Rumi is 5, Khayyam is 3.");
var CatIdSchema = z.number().int().min(0).default(0).describe("Category id (a book or section inside a poet's work). Use 0 for 'all categories' where supported.");

// dist/format.js
function siteUrl(path) {
  if (!path)
    return null;
  if (/^https?:\/\//i.test(path))
    return path;
  return `${SITE_BASE_URL}/${String(path).replace(/^\/+/, "")}`;
}
function lines(...parts) {
  return parts.filter((part) => part !== false && part !== null && part !== void 0);
}
function md(...parts) {
  return lines(...parts).join("\n");
}
function bullets(items, emptyLabel = "none") {
  if (!items.length)
    return `- ${emptyLabel}`;
  return items.map((item) => `- ${item}`).join("\n");
}
function num(value) {
  return value === null || value === void 0 ? "\u2014" : String(value);
}
function date(value) {
  return value ? value : "\u2014";
}
function hijriToGregorianApprox(hijriYear) {
  return String(Math.floor(hijriYear * 0.970224 + 622));
}

// dist/tools/registry.js
function defineTool(server, config, handler) {
  server.registerTool(config.name, {
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
      ...config.annotations
    }
  }, (async (args) => {
    try {
      const result = await handler(args);
      const format = args.response_format ?? ResponseFormat.MARKDOWN;
      const text = format === ResponseFormat.JSON ? JSON.stringify(result.data, null, 2) : result.markdown(args);
      return {
        content: [{ type: "text", text }],
        structuredContent: result.data
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: "text", text: toActionableError(error) }]
      };
    }
  }));
}
var READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};

// dist/tools/poets.js
function registerPoetTools(server) {
  defineTool(server, {
    name: "ganjoor_list_poets",
    title: "List Ganjoor Poets",
    description: `List all poets published on Ganjoor.net, including their biographies.

Returns one row per poet with: id, name, nickname, URL slug, root category id, birth/death years
(Hijri), and birth/death places. Use this first when you need to translate a poet's name to a
numeric id for other Ganjoor tools.

Args:
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  A paginated poet list. For JSON: { total, count, page, page_size, has_more, next_page, poets: [{ id, name, nickname, full_url, root_cat_id, birth_year_hijri, death_year_hijri, birth_place, death_place }] }

Examples:
  - "Who is on Ganjoor?" -> page_size=50
  - "List the poets born in the 10th century Hijri" -> fetch pages and filter birth_year_hijri

Notes:
  - Only public, read-only data. No authentication required.
  - The list is long (~170 poets); paginate rather than requesting page_size=100 repeatedly.`,
    inputSchema: PaginationSchema.extend({ response_format: ResponseFormatSchema }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const { page, page_size } = args;
    const result = await fetchPaged("/api/ganjoor/poets", page, page_size);
    const data = {
      total: result.total ?? null,
      count: result.items.length,
      page: result.page,
      page_size: result.page_size,
      has_more: result.has_more,
      next_page: result.next_page,
      poets: result.items.map((poet) => ({
        id: poet.id,
        name: poet.name,
        nickname: poet.nickname,
        full_url: poet.fullUrl,
        root_cat_id: poet.rootCatId,
        birth_year_hijri: poet.birthYearInLHijri,
        death_year_hijri: poet.deathYearInLHijri,
        birth_place: poet.birthPlace,
        death_place: poet.deathPlace
      }))
    };
    return {
      data,
      markdown: () => {
        if (!result.items.length) {
          return "No poets found for this page. Use a lower page number.";
        }
        const head = md(`# Ganjoor poets (page ${result.page}, ${result.items.length} shown)`, result.has_more ? "More poets available \u2014 increase `page`." : "End of the poet list.");
        const body = result.items.map((poet) => {
          const life = poet.birthYearInLHijri ? `${hijriToGregorianApprox(poet.birthYearInLHijri)}\u2013${poet.deathYearInLHijri ? hijriToGregorianApprox(poet.deathYearInLHijri) : "?"} CE` : "dates unknown";
          return md(`## ${poet.name} (id ${poet.id})`, `- **Slug**: \`${poet.fullUrl}\``, `- **Nickname**: ${poet.nickname ?? "\u2014"}`, `- **Lived**: ${life}`, `- **Birth place**: ${poet.birthPlace ?? "\u2014"} \xB7 **Death place**: ${poet.deathPlace ?? "\u2014"}`, `- **Root category id**: ${poet.rootCatId}`, `- **Web**: ${siteUrl(poet.fullUrl)}`);
        });
        return md(head, "", body.join("\n\n"));
      }
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poet",
    title: "Get Ganjoor Poet",
    description: `Get a single poet's full profile (including biography) by numeric id or URL slug.

Use this to turn a slug like "/hafez" into the numeric poet id, or to read a poet's biography
and catalogue of works.

Args:
  - id (number): Numeric poet id (optional if \`url\` is given). Hafez = 2, Saadi = 7, Rumi = 5.
  - url (string): Poet URL slug such as 'hafez' or '/hafez' (optional if \`id\` is given)
  - include_cats (boolean): Include the poet's top-level book/section list (default: true)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Poet profile with id, name, nickname, biography, birth/death (Hijri + places), plus for JSON:
  { id, name, nickname, biography, birth_year_hijri, death_year_hijri, birth_place, death_place, full_url, cats: [{ id, title, full_url, cat_type }] }

Examples:
  - "Tell me about Hafez" -> url='hafez'
  - "What are Saadi's works?" -> id=7, include_cats=true

Notes:
  - Supply exactly one of \`id\` or \`url\`. If both are given, \`id\` wins.`,
    inputSchema: z2.object({
      id: IdSchema.optional(),
      url: UrlSlugSchema.optional(),
      include_cats: z2.boolean().default(true).describe("Include the poet's top-level list of books/sections."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    if (input.id === void 0 && !input.url) {
      throw new Error("Provide either `id` (numeric poet id) or `url` (poet slug). Use ganjoor_list_poets to look one up.");
    }
    let poet;
    let rootCat = null;
    if (input.id !== void 0) {
      const detail = await ganjoorGet(`/api/ganjoor/poet/${input.id}`, { catPoems: false });
      poet = detail.poet;
      rootCat = detail.cat ?? null;
    } else {
      const page = await ganjoorGet("/api/ganjoor/poet", { url: input.url });
      poet = page.poet;
      rootCat = page.cat ?? null;
    }
    const cats = input.include_cats ? rootCat?.children ?? [] : [];
    const bio = poet.description ?? null;
    const data = {
      id: poet.id,
      name: poet.name,
      nickname: poet.nickname,
      biography: bio,
      full_url: poet.fullUrl,
      root_cat_id: poet.rootCatId ?? rootCat?.id ?? null,
      birth_year_hijri: poet.birthYearInLHijri,
      death_year_hijri: poet.deathYearInLHijri,
      birth_place: poet.birthPlace,
      death_place: poet.deathPlace,
      ...input.include_cats ? {
        cats: cats.map((cat) => ({
          id: cat.id,
          title: cat.title,
          full_url: cat.fullUrl,
          cat_type: cat.catType
        }))
      } : {}
    };
    return {
      data,
      markdown: () => {
        const head = lines(`# ${poet.name}${poet.nickname && poet.nickname !== poet.name ? ` (${poet.nickname})` : ""} \u2014 poet id ${poet.id}`, `- **Web**: ${siteUrl(poet.fullUrl) ?? "\u2014"}`, `- **Born**: ${poet.birthYearInLHijri ? `${poet.birthYearInLHijri} AH (\u2248 ${hijriToGregorianApprox(poet.birthYearInLHijri)} CE)${poet.birthPlace ? ` in ${poet.birthPlace}` : ""}` : "unknown"}`, `- **Died**: ${poet.deathYearInLHijri ? `${poet.deathYearInLHijri} AH (\u2248 ${hijriToGregorianApprox(poet.deathYearInLHijri)} CE)${poet.deathPlace ? ` in ${poet.deathPlace}` : ""}` : "unknown"}`);
        const bioBlock = bio ? md("## Biography", "", bio) : null;
        const catList = input.include_cats ? md("## Books and sections", "", cats.length ? bullets(cats.map((cat) => `${cat.title} \u2014 category id \`${cat.id}\` (type ${cat.catType}: ${cat.catType === 2 ? "book" : cat.catType === 1 ? "poems" : "general"}) \xB7 ${siteUrl(cat.fullUrl)}`)) : "This poet has no published books or sections yet. Use ganjoor_search_poems with poet_id to find their poems.") : null;
        return md(...head, "", bioBlock, catList);
      }
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poets_by_century",
    title: "Get Ganjoor Poets By Century",
    description: `Get every Ganjoor poet grouped into historical half-centuries.

The first group (id 0) holds the "pinned"/featured poets shown on the Ganjoor home page. Each later
group carries a name, an approximate Gregorian year range, and the poets active in that period.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { centuries: [{ id, name, start_year, end_year, poet_count, poets: [{ id, name, full_url }] }] }

Examples:
  - "Which poets are from the 14th century?" -> inspect the century entries and their poets

Notes:
  - The whole payload is returned at once; it is a few hundred KB at most.
  - Grouping is editorial, so a poet appears exactly once.`,
    inputSchema: z2.object({ response_format: ResponseFormatSchema }).strict(),
    annotations: READ_ONLY
  }, async () => {
    const centuries = await ganjoorGet("/api/ganjoor/centuries");
    const data = {
      centuries: centuries.map((century) => ({
        id: century.id,
        name: century.name || "Featured / pinned poets",
        start_year: century.startYear || null,
        end_year: century.endYear || null,
        poet_count: (century.poets ?? []).length,
        poets: (century.poets ?? []).map((poet) => ({
          id: poet.id,
          name: poet.name,
          full_url: poet.fullUrl
        }))
      }))
    };
    return {
      data,
      markdown: () => {
        const blocks = centuries.map((century) => {
          const label = century.name || "Featured / pinned";
          const range = century.startYear || century.endYear ? ` (${num(century.startYear)}\u2013${num(century.endYear)} CE)` : "";
          return md(`## ${label}${range} \u2014 ${(century.poets ?? []).length} poets`, "", bullets((century.poets ?? []).map((poet) => `${poet.name} (id \`${poet.id}\`) \u2014 ${siteUrl(poet.fullUrl)}`), "no poets in this group"));
        });
        return md(`# Ganjoor poets by century (${centuries.length} groups)`, "", blocks.join("\n\n"));
      }
    };
  });
  defineTool(server, {
    name: "ganjoor_list_books",
    title: "List Ganjoor Books",
    description: `List Ganjoor books (named collections such as \u062F\u06CC\u0648\u0627\u0646 \u062D\u0627\u0641\u0638 or \u063A\u0632\u0644\u06CC\u0627\u062A \u0633\u0639\u062F\u06CC), alphabetically.

Every returned entry is a category of type "Book". Use the resulting category id with
ganjoor_get_category to browse the poems inside, or with ganjoor_get_category_poems to list them.

Args:
  - name (string): Optional filter \u2014 only books whose name contains this substring (case-insensitive)
  - poet_id (number): Optional filter \u2014 only books belonging to this poet id
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, books: [{ id, name, poet_id, poet_name, full_url }] }

Examples:
  - "What books does Hafez have?" -> poet_id=2
  - "Find books matching 'ghazal'" -> name='ghazal'
  - "Show me Molavi's collections" -> poet_id=5

Notes:
  - Filtering happens server-side, so it is much cheaper than fetching everything and filtering locally.
  - Ganjoor's book catalog is a curated subset: some major poets (including Hafez) have no entries.
    For them use ganjoor_get_poet with include_cats=true, which lists a poet's sections directly.`,
    inputSchema: z2.object({
      name: z2.string().trim().max(200).optional().describe("Case-insensitive substring filter on the book name, e.g. 'ghazal' or 'divan'."),
      poet_id: z2.number().int().min(0).default(0).describe("Only books belonging to this poet id. 0 disables the filter."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet("/api/ganjoor/book-catalog", {
      name: input.name,
      poetId: input.poet_id > 0 ? input.poet_id : void 0
    });
    const start = (input.page - 1) * input.page_size;
    const items = all.slice(start, start + input.page_size);
    const hasMore = start + items.length < all.length;
    const data = {
      total: all.length,
      count: items.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      books: items.map((book) => ({
        id: book.id,
        name: book.name,
        poet_id: book.poetId,
        poet_name: book.poetName,
        full_url: book.fullUrl
      }))
    };
    return {
      data,
      markdown: () => md(`# Ganjoor books (${all.length} matching, showing ${items.length})`, hasMore ? "More results available \u2014 increase `page`." : null, "", bullets(
        items.map((book) => `${book.name} \u2014 ${book.poetName}, category id \`${book.id}\` \xB7 ${siteUrl(book.fullUrl)}`),
        // The upstream catalog is a curated subset and omits some major poets
        // (notably Hafez), so an empty result needs an alternative route.
        input.poet_id ? `No books are listed for poet id ${input.poet_id} in Ganjoor's book catalog. That catalog is curated and does not cover every poet \u2014 use ganjoor_get_poet with poet_id=${input.poet_id} (include_cats=true) to list this poet's books and sections instead.` : "no books matched this name filter \u2014 try a shorter substring, or omit `name`"
      ))
    };
  });
}

// dist/tools/categories.js
import { z as z3 } from "zod";

// dist/payloads.js
function recitationAudioUrl(recitation) {
  return recitation.mp3Url || recitation.mp3FilePath || recitation.audioSrcUrl || recitation.audioSrc || null;
}
function commentSummary(comment) {
  return {
    id: comment.id,
    poem_id: comment.poem?.id ?? comment.poemId ?? null,
    poem_title: comment.poem?.title ?? comment.poemTitle ?? null,
    poem_url: comment.poem?.fullUrl ?? comment.poem?.urlSlug ?? comment.poemUrl ?? null,
    couplet_index: comment.coupletIndex ?? null,
    user: comment.authorName ?? comment.userName ?? null,
    text: comment.htmlComment ?? comment.text ?? null,
    text_format: comment.htmlComment != null ? "html" : comment.text != null ? "plain" : null,
    date: comment.commentDate ?? comment.sendDate ?? null,
    has_owner_response: comment.hasOwnerResponse ?? null
  };
}
function imageSummary(image) {
  const fullImage = image.url || image.src || null;
  const thumbnail = image.thumbnailImageUrl || image.thumbnailUrl || null;
  return {
    id: image.id,
    url: fullImage || thumbnail,
    full_image_url: fullImage,
    thumbnail_url: thumbnail,
    page_url: image.targetPageUrl || null,
    alt: image.altText ?? image.alt ?? image.title ?? null,
    description: image.description ?? null,
    is_original_source: image.isTextOriginalSource ?? null
  };
}
function geoTagSummary(tag) {
  return {
    id: tag.id,
    poem_id: tag.poemId ?? tag.poem?.id ?? null,
    poem_title: tag.poem?.fullTitle ?? tag.poem?.title ?? null,
    poem_url: tag.poem?.fullUrl ?? null,
    couplet_index: tag.coupletIndex ?? null,
    location_id: tag.locationId ?? tag.location?.id ?? null,
    location_name: tag.location?.name ?? null,
    latitude: tag.location?.latitude ?? tag.latitude ?? null,
    longitude: tag.location?.longitude ?? tag.longitude ?? null,
    lunar_date: tag.lunarDate ?? null,
    lunar_year: tag.lunarYear ?? null,
    lunar_month: tag.lunarMonth ?? null,
    lunar_day: tag.lunarDay ?? null,
    gregorian_date: tag.gregorianDate ?? null,
    lunar_date_total_number: tag.lunarDateTotalNumber ?? null,
    child_cat: tag.childCat ? { id: tag.childCat.id, title: tag.childCat.title } : null,
    couplet_text: tag.coupletText ?? null,
    note: tag.note ?? null
  };
}
function relatedSectionSummary(item) {
  return {
    id: item.id,
    relation_id: item.id,
    poem_id: item.targetPoemId ?? item.poemId,
    section_index: item.targetSectionIndex ?? item.sectionIndex,
    source_poem_id: item.poemId,
    source_section_index: item.sectionIndex,
    poet_name: item.poetName ?? null,
    full_title: item.fullTitle ?? null,
    full_url: item.fullUrl ?? null
  };
}

// dist/tools/categories.js
var CAT_TYPE_LABEL = {
  0: "general",
  1: "poems",
  2: "book"
};
function breadcrumb(cat) {
  const ancestors = (cat.ancestors ?? []).map((a) => a.title);
  return [...ancestors, cat.title].join(" \xBB ");
}
async function fetchCategory(id, params) {
  const response = await ganjoorGet(`/api/ganjoor/cat/${id}`, params);
  const cat = response?.cat ?? response;
  if (!cat || typeof cat.id !== "number") {
    throw new Error(`Error: category ${id} returned an unexpected payload. Verify the id with ganjoor_list_books or ganjoor_get_poet.`);
  }
  return cat;
}
function poemPath(category, poemUrlSlug) {
  const base = String(category.fullUrl ?? "").replace(/\/+$/, "");
  return `${base}/${poemUrlSlug}`.replace(/\/+/g, "/");
}
function catSummary(cat) {
  return {
    id: cat.id,
    title: cat.title,
    full_url: cat.fullUrl,
    cat_type: cat.catType,
    cat_type_label: CAT_TYPE_LABEL[cat.catType] ?? `type ${cat.catType}`,
    parent_id: cat.ancestors?.[cat.ancestors.length - 1]?.id ?? null,
    child_count: (cat.children ?? []).length,
    poem_count: cat.poems?.length ?? null,
    description: cat.description ?? null
  };
}
function registerCategoryTools(server) {
  defineTool(server, {
    name: "ganjoor_get_category",
    title: "Get Ganjoor Category",
    description: `Get a Ganjoor category (a book, section, or sub-collection) by numeric id.

A category is the container for poems inside a poet's work \u2014 for example Hafez's ghazals
(category id 24) or Rumi's Masnavi. The response includes the breadcrumb path, the direct
children (sub-sections), and optionally the poems it contains.

Args:
  - cat_id (number): Category id. Hafez's root category is 9.
  - include_poems (boolean): Include the poems inside this category (default: true)
  - include_children (boolean): Include the direct child categories/sections (default: true)
  - poem_limit (number): Maximum poems to return when include_poems is true, 1-200 (default: 50)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Category metadata: id, title, breadcrumb, description, table-of-contents style, child categories,
  and (optionally) contained poems with their ids, titles and URLs. Set include_poems=false to skip
  the poem list; use ganjoor_list_category_poems when you only want the poems and their total count.

Examples:
  - "What is inside Hafez's ghazals?" -> cat_id=24, include_children=false
  - "List Hafez's sections" -> cat_id=9, include_poems=false

Notes:
  - A category that directly contains poems returns those poems; a pure section returns children
    instead. Follow \`children\` to descend.`,
    inputSchema: z3.object({
      cat_id: IdSchema.describe("Category id. Hafez's root category is 9; use ganjoor_list_books or ganjoor_get_poet to discover others."),
      include_poems: z3.boolean().default(true).describe("Include the poems contained directly in this category."),
      include_children: z3.boolean().default(true).describe("Include the direct child categories."),
      poem_limit: z3.number().int().min(1).max(200).default(50).describe("Maximum poems to include when include_poems is true."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const cat = await fetchCategory(input.cat_id, {
      poems: input.include_poems,
      mainSections: input.include_children
    });
    const poems = (cat.poems ?? []).slice(0, input.poem_limit);
    const children = cat.children ?? [];
    const data = {
      ...catSummary(cat),
      breadcrumb: breadcrumb(cat),
      table_of_contents_style: cat.tableOfContentsStyle,
      // Always report the count so callers can compare collections without
      // paying for the poem list itself.
      poem_count: input.include_poems ? (cat.poems ?? []).length : null,
      ...input.include_children ? {
        children: children.map((child) => ({
          id: child.id,
          title: child.title,
          full_url: child.fullUrl,
          cat_type: child.catType
        }))
      } : {},
      ...input.include_poems ? {
        poems: poems.map((poem) => ({
          id: poem.id,
          title: poem.title,
          full_url: poemPath(cat, poem.urlSlug),
          excerpt: poem.excerpt ?? null
        })),
        poems_total: (cat.poems ?? []).length
      } : {}
    };
    return {
      data,
      markdown: () => {
        const head = lines(`# ${cat.title} (category id ${cat.id})`, `- **Path**: ${breadcrumb(cat)}`, `- **Type**: ${CAT_TYPE_LABEL[cat.catType] ?? cat.catType}`, `- **Web**: ${siteUrl(cat.fullUrl)}`, `- **Children**: ${children.length} \xB7 **Poems**: ${(cat.poems ?? []).length}`);
        const desc = cat.descriptionHtml || cat.description;
        const descBlock = desc ? md("## Description", "", desc) : null;
        const childBlock = input.include_children ? md("## Sub-sections", "", bullets(children.map((child) => `${child.title} \u2014 id \`${child.id}\` \xB7 ${siteUrl(child.fullUrl)}`), "this category has no sub-sections")) : null;
        const poemBlock = input.include_poems ? md(`## Poems in this category (${poems.length} of ${(cat.poems ?? []).length})`, "", bullets(poems.map((poem) => `${poem.title} \u2014 id \`${poem.id}\` \xB7 ${siteUrl(poemPath(cat, poem.urlSlug))}`), "no poems directly in this category")) : null;
        return md(head.join("\n"), "", descBlock, childBlock, poemBlock);
      }
    };
  });
  defineTool(server, {
    name: "ganjoor_list_category_poems",
    title: "List Poems In A Ganjoor Category",
    description: `List the poems contained in a Ganjoor category, optionally filtered by the poem title.

Args:
  - cat_id (number): Category id to list poems from
  - title_contains (string): Optional filter \u2014 only poems whose title contains this text
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Poems per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { total, count, page, page_size, has_more, next_page, category: { id, title, full_url }, poems: [{ id, title, url_slug, full_url, excerpt }] }

Examples:
  - "Which poems are in category 24?" -> cat_id=24
  - "Find the '\u0634\u0645\u0627\u0631\u0647\u0654 \u06F1' poems in a category" -> title_contains='\u0634\u0645\u0627\u0631\u0647\u0654 \u06F1'

Notes:
  - Title filtering is done client-side because the upstream category endpoint is unpaged.
  - For large collections, combine this with page_size to walk the whole diwan.`,
    inputSchema: z3.object({
      cat_id: IdSchema.describe("Category id to list poems from."),
      title_contains: z3.string().trim().max(200).optional().describe("Optional case-insensitive substring filter applied to poem titles."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const cat = await fetchCategory(input.cat_id, {
      poems: true,
      mainSections: false
    });
    let poems = cat.poems ?? [];
    if (input.title_contains) {
      const needle = input.title_contains.toLocaleLowerCase();
      poems = poems.filter((poem) => poem.title.toLocaleLowerCase().includes(needle));
    }
    const start = (input.page - 1) * input.page_size;
    const items = poems.slice(start, start + input.page_size);
    const hasMore = start + items.length < poems.length;
    const data = {
      total: poems.length,
      count: items.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      category: { id: cat.id, title: cat.title, full_url: cat.fullUrl },
      poems: items.map((poem) => ({
        id: poem.id,
        title: poem.title,
        url_slug: poem.urlSlug,
        full_url: poemPath(cat, poem.urlSlug),
        excerpt: poem.excerpt ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# Poems in "${cat.title}" (category id ${cat.id})`, `${poems.length} poems match${hasMore ? " \u2014 more pages available" : ""}`, "", bullets(items.map((poem) => `${poem.title} \u2014 id \`${poem.id}\` \xB7 ${siteUrl(poemPath(cat, poem.urlSlug))}`), "no poems matched"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_category_geotags",
    title: "Get Category Geo Tags",
    description: `Get the geographic and historical locations tagged to poems within a Ganjoor category and its descendants.

Each tag pairs a place with the Hijri/Gregorian date a poem commemorates, which is how Ganjoor
records historical events (a battle, a siege) in poetry.

Args:
  - cat_id (number): Category id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { total, tags: [{ id, latitude, longitude, lunar_date, gregorian_date, child_cat }] }

Examples:
  - "Where are the events in Hafez's poetry set?" -> cat_id=9

Notes:
  - Tag lists can be large (tens of entries for a whole diwan).
  - Coordinates are decimal degrees, WGS84.`,
    inputSchema: z3.object({
      cat_id: IdSchema.describe("Category id whose subtree should be scanned for geo tags."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const tags = await ganjoorGet(`/api/ganjoor/cat/${input.cat_id}/geotag`);
    const data = {
      total: tags.length,
      tags: tags.map(geoTagSummary)
    };
    return {
      data,
      markdown: () => md(`# Geo tags under category ${input.cat_id} (${tags.length} tags)`, "", bullets(data.tags.map((tag) => {
        const coords = tag.latitude !== null && tag.longitude !== null ? `${tag.latitude}, ${tag.longitude}` : "no coordinates";
        const dates = [tag.lunar_date ?? tag.lunar_year, tag.gregorian_date].filter(Boolean).join(" / ");
        return `${tag.location_name ?? "unnamed location"} \u2014 ${dates || "undated"} \u2014 ${coords}${tag.poem_url ? ` \xB7 ${siteUrl(tag.poem_url)}` : ""}`;
      }), "no geo tags found"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_category_people_graph",
    title: "Get Category People Graph",
    description: `Get the network of historical people relevant to a Ganjoor category or work.

Returns every person tagged in a poem under this category's subtree, plus their kinship and
affiliation ties one hop out \u2014 the data behind Ganjoor's "characters" (\u0634\u062E\u0635\u06CC\u062A\u200C\u0647\u0627) tab.

Args:
  - cat_id (number): Category id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { node_count, edge_count, nodes: [{ id, name, importance }], edges: [{ from_person_id, to_person_id, relation }] }

Examples:
  - "Which historical figures appear in the Shahnameh?" -> cat_id=<Shahnameh category id>

Notes:
  - Empty graphs are normal for categories with no person tagging \u2014 that is not an error.`,
    inputSchema: z3.object({
      cat_id: IdSchema.describe("Category id to build the people graph for."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const graph = await ganjoorGet(`/api/ganjoor/cat/${input.cat_id}/persongraph`);
    const nodes = graph?.nodes ?? [];
    const edges = graph?.edges ?? [];
    const data = {
      node_count: nodes.length,
      edge_count: edges.length,
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        importance: node.importance ?? null
      })),
      edges: edges.map((edge) => ({
        from_person_id: edge.person1Id ?? edge.from ?? null,
        to_person_id: edge.person2Id ?? edge.to ?? null,
        relation: edge.relation ?? null,
        relation_category: edge.category ?? null,
        relation_type: edge.typeValue ?? null,
        degree_hint: edge.degreeHint ?? null,
        note: edge.note ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# People graph for category ${input.cat_id}`, `${nodes.length} people, ${edges.length} relations`, "", bullets(nodes.map((node) => `${node.name} (person id \`${node.id}\`)`), "no people are tagged in this category"), "")
    };
  });
}

// dist/tools/poems.js
import { z as z4 } from "zod";
function poemSummary(poem) {
  return {
    id: poem.id,
    title: poem.title,
    full_title: poem.fullTitle,
    full_url: poem.fullUrl,
    couplets_count: poem.coupletsCount ?? null,
    language: poem.language ?? null
  };
}
function renderPoemList(poems) {
  return md(bullets(poems.map((poem) => `${poem.full_title} \u2014 id \`${poem.id}\` \xB7 ${siteUrl(poem.full_url)}`), "no poems matched"));
}
function registerPoemTools(server) {
  defineTool(server, {
    name: "ganjoor_search_poems",
    title: "Search Ganjoor Poems",
    description: `Full-text search across all poems on Ganjoor, optionally scoped to one poet or category.

The search matches Persian text inside poem bodies and titles. Use this when you know what the
poem says but not what it is called; use ganjoor_list_category_poems when you know the book.

Args:
  - term (string): Search text. Persian phrases work best; matches are substring based.
  - poet_id (number): Restrict to one poet (default: 0 = all poets)
  - cat_id (number): Restrict to one category (default: 0 = all categories)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Results per page, 1-100 (default: 20)
  - include_text (boolean): Include each poem's full text in the response (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, poems: [{ id, title, full_title, full_url, plain_text? }] }

Examples:
  - "Find poems mentioning '\u062F\u0644'" -> term='\u062F\u0644', poet_id=2
  - "Search Hafez for '\u0635\u0628\u0631'" -> term='\u0635\u0628\u0631', poet_id=2
  - "Give me the full text of the matches" -> include_text=true

Notes:
  - Narrow with \`poet_id\` or \`cat_id\` first: unfiltered search over all poems is broad and slow
    to page through.
  - Set \`include_text=true\` only for a small page; full poems are long.`,
    inputSchema: z4.object({
      term: z4.string().trim().min(1, "Search term must not be empty").max(200, "Search term must not exceed 200 characters").describe("Persian text to search for, e.g. '\u0635\u0628\u0631', '\u062F\u0644', '\u0645\u0639\u0631\u0641\u062A'."),
      poet_id: z4.number().int().min(0).default(0).describe("Restrict to a poet id. 0 searches all poets."),
      cat_id: z4.number().int().min(0).default(0).describe("Restrict to a category id. 0 searches all categories."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      include_text: z4.boolean().default(false).describe("Include the full poem text for each result."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const list = await fetchPaged("/api/ganjoor/poems/search", input.page, input.page_size, {
      term: input.term,
      poetId: input.poet_id > 0 ? input.poet_id : void 0,
      catId: input.cat_id > 0 ? input.cat_id : void 0
    });
    const poems = list.items.map((poem) => ({
      ...poemSummary(poem),
      ...input.include_text ? { plain_text: poem.plainText } : {}
    }));
    const data = {
      term: input.term,
      count: poems.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      poems
    };
    return {
      data,
      markdown: () => {
        const scope = input.poet_id ? ` (poet id ${input.poet_id})` : "";
        if (!poems.length) {
          return `No poems matched "${input.term}"${scope}. Try a shorter or more common word, or drop the poet/category filter.`;
        }
        const head = lines(`# Search results for "${input.term}"${scope} \u2014 ${poems.length} shown (page ${list.page})`, list.has_more ? "More results \u2014 increase `page`." : null);
        if (!input.include_text) {
          return md(head.join("\n"), "", renderPoemList(poems));
        }
        const body = poems.map((poem) => md(`## ${poem.full_title}`, `- **Id**: ${poem.id} \xB7 **URL**: ${siteUrl(poem.full_url)}`, "", poem.plain_text ?? null));
        return md(head.join("\n"), "", body.join("\n\n"));
      }
    };
  });
  defineTool(server, {
    name: "ganjoor_semantic_search_poems",
    title: "Semantic Search Ganjoor Poems",
    description: `Meaning-based ("find a poem about...") search over Ganjoor's poetry collection.

Use this when you want poems by theme or feeling rather than an exact word. Describe the idea in
natural language \u2014 in English or Persian \u2014 and Ganjoor's embedding search returns the closest
verses. Prefer ganjoor_search_poems when you have an exact phrase to look for.

Args:
  - query (string): Natural-language description of the poem's theme, 1-500 characters
  - top_k (number): How many poems to return, 1-50 (default: 10)
  - poet_id (number): Restrict to a poet id. 0 = all poets (default: 0)
  - cat_id (number): Restrict to a category id. 0 = all categories (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, results: [{ id, title, full_title, full_url, plain_text }] } ordered by relevance.

Examples:
  - "Poems about patience and divine trust" -> query='patience and trust in God'
  - "\u063A\u0632\u0644\u06CC \u062F\u0631\u0628\u0627\u0631\u0647\u0654 \u062C\u062F\u0627\u06CC\u06CC \u0627\u0632 \u0645\u0639\u0634\u0648\u0642" -> query='a ghazal about separation from the beloved'

Notes:
  - Ganjoor's semantic backend is an optional feature that some deployments leave disabled; when it
    is off this tool returns a 503 with a message saying so. In that case fall back to
    ganjoor_search_poems with a Persian keyword describing the theme.
  - Relevance ordering is approximate \u2014 always quote the returned text rather than paraphrasing it.`,
    inputSchema: z4.object({
      query: z4.string().trim().min(1, "Query must not be empty").max(500, "Query must not exceed 500 characters").describe("Natural-language description of the theme, e.g. 'a poem about longing for the beloved'."),
      top_k: z4.number().int().min(1).max(50).default(10).describe("Number of poems to return (1-50, default 10)."),
      poet_id: z4.number().int().min(0).default(0).describe("Restrict to a poet id. 0 searches all poets."),
      cat_id: z4.number().int().min(0).default(0).describe("Restrict to a category id. 0 searches all categories."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    let results;
    try {
      results = await ganjoorPost("/api/ganjoor/search/semantic", {
        query: input.query,
        topK: input.top_k,
        poetId: input.poet_id,
        catId: input.cat_id,
        disableScopeDetection: false
      }, {});
    } catch (error) {
      if (error instanceof GanjoorApiError && error.status === 503) {
        throw new Error(`Error: Ganjoor's semantic search is disabled on this server, so meaning-based search is unavailable. Use ganjoor_search_poems instead with a Persian keyword describing the theme of your question (for example a word meaning "${input.query}").`);
      }
      throw error;
    }
    const list = Array.isArray(results) ? results.slice(0, input.top_k) : [];
    const data = {
      query: input.query,
      count: list.length,
      results: list.map((poem) => ({
        ...poemSummary(poem),
        plain_text: poem.plainText
      }))
    };
    const resultBlocks = list.map((poem, index) => md(`## ${index + 1}. ${poem.fullTitle}`, `- **Id**: ${poem.id} \xB7 ${siteUrl(poem.fullUrl)}`, "", poem.plainText));
    return {
      data,
      markdown: () => md(`# Semantic results for "${input.query}" (${list.length} poems)`, "", list.length ? null : "No semantically similar poems found. Try rephrasing the theme in simpler words.", resultBlocks.join("\n\n"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem",
    title: "Get Ganjoor Poem By URL",
    description: `Fetch a complete poem by its Ganjoor URL, including verses, metre, rhyme, and recitations.

This is the main way to read a poem. The URL is the same as the browser address on ganjoor.net,
e.g. "hafez/ghazal/sh494". Use ganjoor_search_poems or ganjoor_list_category_poems to discover
URLs, and ganjoor_get_poem_by_id when you only have a numeric id.

Args:
  - url (string): Poem URL slug, with or without leading slash, e.g. 'hafez/ghazal/sh494'
  - include_category (boolean): Include the book/category metadata (default: true)
  - include_siblings (boolean): Include the list of other poems in the same book (default: false)
  - include_recitations (boolean): Include audio recitations (default: true)
  - include_images (boolean): Include manuscript images (default: false)
  - include_comments (boolean): Include published reader comments (default: false)
  - include_verse_details (boolean): Include per-verse ids, positions, and couplet summaries (default: true)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Poem id, title, full title, poet, book/category path, plain text, and the ordered verse list grouped
  into couplets. For JSON: { id, title, full_title, full_url, poet, category, couplets_count, verses: [{ couplet_index, position, text }], recitations: [...], next_poem, previous_poem }

Examples:
  - "Show me Hafez's ghazal 494" -> url='hafez/ghazal/sh494'
  - "Read this poem with its commentary" -> include_comments=true

Notes:
  - Persian text is returned verbatim; it is right-to-left, so present it as-is.
  - Keep include_siblings and include_comments false unless needed \u2014 both can be very large.`,
    inputSchema: z4.object({
      url: UrlSlugSchema,
      include_category: z4.boolean().default(true).describe("Include the poem's category/book metadata."),
      include_siblings: z4.boolean().default(false).describe("Include all other poems in the same book. Can be very large."),
      include_recitations: z4.boolean().default(true).describe("Include audio recitations of the poem."),
      include_images: z4.boolean().default(false).describe("Include manuscript image links."),
      include_comments: z4.boolean().default(false).describe("Include published reader comments."),
      include_verse_details: z4.boolean().default(true).describe("Include per-verse ids, positions, and AI summaries."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const poem = await ganjoorGet("/api/ganjoor/poem", {
      url: input.url,
      catInfo: input.include_category,
      catPoems: input.include_siblings,
      rhymes: true,
      recitations: input.include_recitations,
      images: input.include_images,
      songs: false,
      comments: input.include_comments,
      // Upstream drops the verse array entirely when this is false, so it stays
      // on and `include_verse_details` only controls local rendering.
      verseDetails: true,
      navigation: true
    });
    return buildPoemResponse(poem, input);
  });
  defineTool(server, {
    name: "ganjoor_get_poem_by_id",
    title: "Get Ganjoor Poem By Id",
    description: `Fetch a complete poem by its numeric Ganjoor id.

Same content as ganjoor_get_poem, but keyed on the numeric poem id instead of the URL. Use it when
you have an id from search results or another tool and do not want to build a URL.

Args:
  - poem_id (number): Numeric poem id
  - include_category (boolean): Include the book/category metadata (default: true)
  - include_recitations (boolean): Include audio recitations (default: false)
  - include_comments (boolean): Include published reader comments (default: false)
  - include_verse_details (boolean): Include per-verse ids and positions plus the prose summary for each couplet (default: true). Set false for a leaner payload; the verse text itself is always returned.
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Identical shape to ganjoor_get_poem.

Examples:
  - "Show poem 2623" -> poem_id=2623
  - "What is poem 13836?" -> poem_id=13836

Notes:
  - Combined with ganjoor_get_page_url you can also resolve an id to its web address.`,
    inputSchema: z4.object({
      poem_id: IdSchema.describe("Numeric poem id, e.g. 2623 for a Hafez ghazal."),
      include_category: z4.boolean().default(true).describe("Include category metadata."),
      include_recitations: z4.boolean().default(false).describe("Include audio recitations."),
      include_comments: z4.boolean().default(false).describe("Include reader comments."),
      include_verse_details: z4.boolean().default(true).describe("Include per-verse ids, positions, and summaries."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const poem = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}`, {
      catInfo: input.include_category,
      recitations: input.include_recitations,
      images: false,
      songs: false,
      comments: input.include_comments,
      verseDetails: true
    });
    return buildPoemResponse(poem, input);
  });
  defineTool(server, {
    name: "ganjoor_get_poem_verses",
    title: "Get Ganjoor Poem Verses",
    description: `Get just the verses of a poem by id \u2014 a lightweight alternative to fetching the whole poem.

Each verse comes back in order with its couplet index and whether it is the first or second hemi-
stich. Optionally restrict to a single couplet.

Args:
  - poem_id (number): Numeric poem id
  - couplet_index (number): Return only this couplet (0-based). Omit for the whole poem.
  - include_summary (boolean): Include the per-couplet prose summary (default: false)
  - include_original_text (boolean): Include the uncorrected original text where available (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, verse_count, verses: [{ id, order, couplet_index, position, text }] }

Examples:
  - "Quote the verses of poem 2623" -> poem_id=2623
  - "Show only couplet 3" -> poem_id=2623, couplet_index=3

Notes:
  - Position 0 is the first hemistich, position 1 the second; couplet_index groups them.`,
    inputSchema: z4.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      couplet_index: z4.number().int().min(0).optional().describe("Return only this 0-based couplet. Omit to get the whole poem."),
      include_summary: z4.boolean().default(false).describe("Include the modern Persian summary attached to each couplet."),
      include_original_text: z4.boolean().default(false).describe("Include the pre-correction original text where the API has it."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const verses = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/verses`, { coupletIndex: input.couplet_index ?? -1 });
    const list = Array.isArray(verses) ? verses : [];
    const data = {
      poem_id: input.poem_id,
      verse_count: list.length,
      verses: list.map((verse) => ({
        id: verse.id,
        order: verse.vOrder,
        couplet_index: verse.coupletIndex,
        position: verse.versePosition,
        text: verse.text,
        ...input.include_summary ? { couplet_summary: verse.coupletSummary } : {},
        ...input.include_original_text ? { original_text: verse.originalText } : {}
      }))
    };
    return {
      data,
      markdown: () => md(`# Verses of poem ${input.poem_id} (${list.length} hemistichs)`, "", list.length ? "" : "No verses returned \u2014 verify the poem id with ganjoor_search_poems.", ...list.map((verse) => `[${verse.versePosition === 0 ? "\u06F1" : "\u06F2"}] ${verse.text}`), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_random_poem",
    title: "Get Random Ganjoor Poem",
    description: `Get a random poem from Ganjoor, optionally from a specific poet.

Args:
  - poet_id (number): Poet to draw from. 0 = a random poet (default: 0). Hafez = 2.
  - include_recitations (boolean): Include audio recitations (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  A single complete poem in the same shape as ganjoor_get_poem_by_id.

Examples:
  - "Surprise me with a poem" -> no arguments
  - "A random Saadi poem" -> poet_id=7

Notes:
  - Non-deterministic: repeated calls return different poems.`,
    inputSchema: z4.object({
      poet_id: z4.number().int().min(0).default(0).describe("Poet id to draw from. 0 = any poet. Hafez = 2, Saadi = 7, Rumi = 5."),
      include_recitations: z4.boolean().default(false).describe("Include audio recitations."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const poem = await ganjoorGet("/api/ganjoor/poem/random", {
      poetId: input.poet_id
    });
    return buildPoemResponse(poem, {
      include_category: true,
      include_recitations: input.include_recitations,
      include_comments: false,
      include_verse_details: true
    });
  });
  defineTool(server, {
    name: "ganjoor_get_hafez_faal",
    title: "Get Hafez Faal (Divination)",
    description: `Draw a random Hafez ghazal as a Persian divination (\u0641\u0627\u0644 \u062D\u0627\u0641\u0638).

This is the traditional "ask Hafez" reading: one ghazal selected at random, to be interpreted in
the context of the question asked. Each call draws a different ghazal.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  A complete Hafez ghazal in the same shape as ganjoor_get_poem_by_id.

Examples:
  - "Draw a faal for me" -> no arguments
  - "What does Hafez say about my question?" -> no arguments

Notes:
  - Non-deterministic. The interpretation is traditionally left to the reader.`,
    inputSchema: z4.object({ response_format: ResponseFormatSchema }).strict(),
    annotations: READ_ONLY
  }, async () => {
    const poem = await ganjoorGet("/api/ganjoor/hafez/faal");
    return buildPoemResponse(poem, {
      include_category: true,
      include_recitations: false,
      include_comments: false,
      include_verse_details: true
    });
  });
  defineTool(server, {
    name: "ganjoor_get_page_url",
    title: "Resolve Ganjoor Page Id To URL",
    description: `Resolve any Ganjoor page id (poem, category, or poet) to its public web URL path.

Useful when you have a bare numeric id from an index or a citation and need to cite or link it.

Args:
  - id (number): Any Ganjoor page id \u2014 poem, category, or poet
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { id, url, full_url }

Examples:
  - "What is the link for id 13836?" -> id=13836

Notes:
  - Ids are globally unique across poems, categories and poets on Ganjoor.`,
    inputSchema: z4.object({
      id: IdSchema.describe("Page id to resolve. Works for poems, categories, and poets."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const url = await ganjoorGet("/api/ganjoor/pageurl", { id: input.id });
    const data = {
      id: input.id,
      url: typeof url === "string" ? url : String(url ?? ""),
      full_url: siteUrl(typeof url === "string" ? url : String(url ?? ""))
    };
    return {
      data,
      markdown: () => md(`# Ganjoor page ${input.id}`, `- **URL path**: \`${data.url}\``, `- **Full URL**: ${data.full_url}`, "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_redirect_url",
    title: "Resolve Ganjoor Redirect",
    description: `Resolve a legacy or short Ganjoor URL to its current canonical address.

Ganjoor has renamed many sections over the years; this endpoint maps an old path to today's one.

Args:
  - url (string): The URL path to resolve, with or without a leading slash
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { requested_url, redirect_url, full_url, has_redirect } \u2014 redirect_url is null and
  has_redirect is false when Ganjoor has no redirect for that URL (which includes URLs that are
  already canonical).

Examples:
  - "Where does an old Hafez section URL go now?" -> url='hafez/divan/ghazal/sh1'

Notes:
  - Ganjoor only keeps explicit redirects for paths it actually renamed; most valid URLs return
    has_redirect=false rather than a target.`,
    inputSchema: z4.object({
      url: UrlSlugSchema.describe("URL path to resolve, e.g. 'hafez/divan'."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    let target = null;
    try {
      const raw = await ganjoorGet("/api/ganjoor/redirecturl", { url: input.url });
      target = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    } catch (error) {
      if (!(error instanceof GanjoorApiError) || error.status !== 404)
        throw error;
    }
    const redirect = target;
    const data = {
      requested_url: input.url,
      redirect_url: redirect,
      full_url: redirect ? siteUrl(redirect) : null,
      has_redirect: redirect !== null
    };
    return {
      data,
      markdown: () => md(`# Redirect resolution`, `- **Requested**: \`${input.url}\``, redirect ? `- **Redirects to**: \`${redirect}\` (${siteUrl(redirect)})` : "- **Redirects to**: no redirect \u2014 this URL is either already canonical or not tracked by Ganjoor", "")
    };
  });
}
function buildPoemResponse(poem, options) {
  const verses = Array.isArray(poem.verses) ? poem.verses : [];
  const recitations = poem.recitations ?? [];
  const comments = poem.comments ?? [];
  const images = poem.images ?? [];
  const sections = poem.sections ?? [];
  const metres = [...new Map(sections.filter((s) => s.ganjoorMetre?.rhythm).map((s) => [s.ganjoorMetre.rhythm, s.ganjoorMetre])).values()];
  const storedMetre = metres.length === 1 ? { id: metres[0].id, rhythm: metres[0].rhythm } : null;
  const category = options.include_category ? poem.category?.cat ?? null : null;
  const poet = options.include_category ? poem.category?.poet ?? null : null;
  const data = {
    id: poem.id,
    title: poem.title,
    full_title: poem.fullTitle,
    full_url: poem.fullUrl,
    web_url: siteUrl(poem.fullUrl),
    plain_text: poem.plainText,
    source_name: poem.sourceName ?? null,
    metre: storedMetre,
    metre_source: storedMetre ? "stored" : null,
    metres: metres.map((metre) => ({ id: metre.id, rhythm: metre.rhythm })),
    rhyme: sections.length === 1 ? sections[0].rhymeLetters ?? null : null,
    language: poem.language ?? null,
    verse_count: verses.length,
    // Upstream never populates coupletsCount, so derive it from the verses.
    couplets_count: verses.length > 0 ? new Set(verses.map((verse) => verse.coupletIndex)).size : null,
    ...category ? {
      category: {
        id: category.id,
        title: category.title,
        full_url: category.fullUrl,
        cat_type: category.catType
      }
    } : {},
    ...poet ? {
      poet: { id: poet.id, name: poet.name, full_url: poet.fullUrl }
    } : {},
    ...poem.next ? { next_poem: { id: poem.next.id, title: poem.next.title, url_slug: poem.next.urlSlug } } : {},
    ...poem.previous ? {
      previous_poem: {
        id: poem.previous.id,
        title: poem.previous.title,
        url_slug: poem.previous.urlSlug
      }
    } : {},
    verses: verses.map((verse) => ({
      id: options.include_verse_details ? verse.id : null,
      order: verse.vOrder,
      couplet_index: verse.coupletIndex,
      position: verse.versePosition,
      text: verse.text,
      ...options.include_verse_details ? { couplet_summary: verse.coupletSummary } : {}
    })),
    ...options.include_recitations ? {
      recitations: recitations.map((recitation) => ({
        id: recitation.id,
        title: recitation.audioTitle,
        artist: recitation.audioArtist,
        artist_url: recitation.audioArtistUrl,
        audio_url: recitationAudioUrl(recitation),
        publish_date: recitation.publishDate
      }))
    } : {},
    ...options.include_comments ? {
      comments: comments.map(commentSummary)
    } : {},
    ...options.include_images ? { images: images.map(imageSummary) } : {}
  };
  const recitationBlock = options.include_recitations && recitations.length ? md("## Recitations", "", bullets(recitations.map((recitation) => `${recitation.audioTitle ?? "untitled"} \u2014 ${recitation.audioArtist ?? "unknown artist"}${recitationAudioUrl(recitation) ? ` \xB7 ${recitationAudioUrl(recitation)}` : ""}`))) : null;
  const commentBlock = options.include_comments && comments.length ? md("## Comments", "", bullets(comments.slice(0, 20).map((comment) => {
    const summary = commentSummary(comment);
    return `${summary.user ?? "anonymous"}: ${(summary.text ?? "").slice(0, 200)}`;
  }))) : null;
  const coupletsCount = poem.coupletsCount ?? (verses.length > 0 ? new Set(verses.map((verse) => verse.coupletIndex)).size : null);
  const markdown = md(`# ${poem.fullTitle}`, `- **Id**: ${poem.id}`, `- **URL**: ${siteUrl(poem.fullUrl)}`, poet ? `- **Poet**: ${poet.name} (${siteUrl(poet.fullUrl)})` : null, category ? `- **Book**: ${category.title} (category id ${category.id})` : null, coupletsCount ? `- **Couplets**: ${coupletsCount}` : null, storedMetre ? `- **Stored metre**: ${storedMetre.rhythm}` : null, "", "## Verses", "", verses.length ? null : "No verses returned.", groupVersesIntoCouplets(verses, options.include_verse_details).join("\n\n"), recitationBlock, commentBlock, options.include_images && images.length ? md("## Manuscript images", "", bullets(images.map((image) => {
    const summary = imageSummary(image);
    return `${summary.alt ?? `image ${summary.id}`} \u2014 ${summary.url ?? "no image URL"}${summary.page_url ? ` \xB7 ${summary.page_url}` : ""}`;
  }))) : null);
  return { data, markdown: () => markdown };
}
function groupVersesIntoCouplets(verses, includeDetails) {
  const byCouplet = /* @__PURE__ */ new Map();
  for (const verse of verses) {
    const bucket = byCouplet.get(verse.coupletIndex) ?? [];
    bucket.push(verse);
    byCouplet.set(verse.coupletIndex, bucket);
  }
  const blocks = [];
  for (const [index, pair] of [...byCouplet.entries()].sort((a, b) => a[0] - b[0])) {
    const ordered = [...pair].sort((a, b) => a.versePosition - b.versePosition);
    const text = ordered.map((verse) => verse.text).join("\n");
    const summary = includeDetails ? ordered.find((verse) => verse.coupletSummary)?.coupletSummary : null;
    blocks.push(summary ? `${String(index + 1).padStart(3, " ")}. ${text}
     _${summary}_` : `${String(index + 1).padStart(3, " ")}. ${text}`);
  }
  return blocks;
}

// dist/tools/analysis.js
import { z as z5 } from "zod";
function registerAnalysisTools(server) {
  defineTool(server, {
    name: "ganjoor_list_rhythms",
    title: "List Ganjoor Metres (Rhythms)",
    description: `List every Persian prosodic metre (\u0648\u0632\u0646) used in the Ganjoor corpus, with its verse-pattern notation.

Use this to translate a metre name into the id Ganjoor uses, or to discover the metre vocabulary
before calling ganjoor_find_similar_poems or ganjoor_analyze_poem_rhythm.

Args:
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 50)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, rhythms: [{ id, rhythm, verse_count }] }

Examples:
  - "What metres exist?" -> no arguments
  - "Find the metre '\u0641\u0627\u0639\u0644\u0627\u062A\u0646'" -> page through results looking for the pattern

Notes:
  - \`rhythm\` is the classical Persian scansion pattern; \`verse_count\` is how many Ganjoor poems use it.
  - There are roughly 50-70 metres; one page of 100 usually covers everything.`,
    inputSchema: PaginationSchema.extend({ response_format: ResponseFormatSchema }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const { page, page_size } = args;
    const list = await fetchPaged("/api/ganjoor/rhythms", page, page_size);
    const data = {
      count: list.items.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      rhythms: list.items.map((metre) => ({
        id: metre.id,
        rhythm: metre.rhythm,
        verse_count: metre.verseCount
      }))
    };
    return {
      data,
      markdown: () => md(`# Ganjoor metres (${list.items.length} shown, page ${list.page})`, list.has_more ? "More \u2014 increase `page`." : "End of the metre list.", "", bullets(list.items.map((metre) => `${metre.rhythm} \u2014 id \`${metre.id}\`, ${num(metre.verseCount)} poems`), "no metres returned"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_analyze_poem_rhythm",
    title: "Analyze Poem Rhythm (Metre)",
    description: `Detect the prosodic metre (\u0648\u0632\u0646) of a poem by its numeric id.

Runs Ganjoor's prosody engine over the poem's verses. The current API returns a rhythm string;
an empty string means no automatic detection. When detection fails, the separately labelled
stored_metre field gives the editorially recorded weight if available.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, metre, detection_status, stored_metre, best_candidate, second_best_candidate, third_best_candidate, score }

Examples:
  - "What metre is poem 2623 in?" -> poem_id=2623

Notes:
  - The detected metre may differ from the poem's stored metre for edited or composite texts.`,
    inputSchema: z5.object({
      poem_id: IdSchema.describe("Numeric poem id to analyze."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const raw = await ganjoorGet(`/api/ganjoor/poem/analysisrhythm/${input.poem_id}`);
    const result = typeof raw === "object" && raw !== null ? raw : null;
    const rhythm = (typeof raw === "string" ? raw.trim() : result?.metreRhythm || result?.bestCandidate) || null;
    let storedMetre = null;
    if (!rhythm) {
      const sections = await ganjoorGet(`/api/ganjoor/sections/${input.poem_id}`);
      const metres = [...new Map((Array.isArray(sections) ? sections : []).filter((section) => section.ganjoorMetre?.rhythm).map((section) => [section.ganjoorMetre.rhythm, section.ganjoorMetre])).values()];
      if (metres.length === 1)
        storedMetre = { id: metres[0].id, rhythm: metres[0].rhythm };
    }
    const data = {
      poem_id: input.poem_id,
      metre: rhythm ? { id: result?.metreId ?? null, rhythm } : null,
      detection_status: rhythm ? "detected" : "not_detected",
      stored_metre: storedMetre,
      best_candidate: result?.bestCandidate ?? null,
      second_best_candidate: result?.secondBestCandidate ?? null,
      third_best_candidate: result?.thirdBestCandidate ?? null,
      score: result?.score ?? null
    };
    return {
      data,
      markdown: () => md(`# Rhythm analysis \u2014 poem ${input.poem_id}`, `- **Metre**: ${rhythm ?? "not detected"}`, storedMetre ? `- **Stored metre (not automatic detection)**: ${storedMetre.rhythm}` : null, result?.bestCandidate ? `- **Best candidate**: ${result.bestCandidate}` : null, result?.secondBestCandidate ? `- **Runner-up**: ${result.secondBestCandidate}` : null, result?.score !== void 0 && result?.score !== null ? `- **Score**: ${result.score}` : null, "")
    };
  });
  defineTool(server, {
    name: "ganjoor_analyze_poem_rhyme",
    title: "Analyze Poem Rhyme",
    description: `Detect the rhyme letter (\u0642\u0627\u0641\u06CC\u0647) and rhyme pattern of a poem by its numeric id.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, rhyme, rhyme_letter, fail_verse } \u2014 \`rhyme\` is the full rhyming ending as the
  prosody engine sees it, and \`rhyme_letter\` is its last character.

Examples:
  - "What is the rhyme of poem 2623?" -> poem_id=2623

Notes:
  - Some poems (short texts, composite editions) have no determinable rhyme; those return
    rhyme=null plus a fail_verse note explaining where analysis stopped.`,
    inputSchema: z5.object({
      poem_id: IdSchema.describe("Numeric poem id to analyze."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const raw = await ganjoorGet(`/api/ganjoor/poem/analysisrhyme/${input.poem_id}`);
    const result = typeof raw === "string" ? { rhyme: null, failVerse: raw } : raw ?? { rhyme: null, failVerse: null };
    const rhyme = result.rhyme ?? null;
    const rhymeLetter = rhyme ? rhyme.slice(-1) : null;
    const data = {
      poem_id: input.poem_id,
      rhyme,
      rhyme_letter: rhymeLetter,
      fail_verse: result.failVerse ?? null
    };
    return {
      data,
      markdown: () => md(`# Rhyme analysis \u2014 poem ${input.poem_id}`, rhyme ? `- **Rhyme**: ${rhyme}` : null, rhymeLetter ? `- **Rhyme letter**: ${rhymeLetter}` : null, result.failVerse ? `- **Note**: ${result.failVerse}` : null, rhyme ? null : "- No rhyme could be determined for this poem.")
    };
  });
  defineTool(server, {
    name: "ganjoor_find_similar_poems",
    title: "Find Similar Poems By Metre And Rhyme",
    description: `Find poems that share a poem's prosodic metre and rhyme letter \u2014 the basis of Ganjoor's "related poems" (\u0634\u0639\u0631\u0647\u0627\u06CC \u0645\u0631\u062A\u0628\u0637) pages.

Two Persian poems matching in metre and rhyme can be read as answers to each other (reply-poetry),
so this is also how you trace how one poet answered another.

Args:
  - metre (string): The prosodic metre pattern, exactly as listed by ganjoor_list_rhythms
  - rhyme (string): Optional rhyme letter filter (e.g. '\u0627', '\u0628'). Empty means any.
  - poet_id (number): Restrict to a poet id. 0 = all poets (default: 0)
  - cat_id (number): Restrict to a category id. 0 = all categories (default: 0)
  - couplet_count_min (number): Only poems with at least this many couplets (default: 0)
  - couplet_count_max (number): Only poems with at most this many couplets (default: 0, meaning no cap)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Results per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, poems: [{ id, title, full_title, full_url, plain_text }] }

Examples:
  - "Which Hafez poems share metre '\u0641\u0627\u0639\u0644\u0627\u062A\u0646 \u0645\u0641\u0627\u0639\u0644\u0646 \u0641\u0639\u0644\u0646'?" -> metre='\u0641\u0627\u0639\u0644\u0627\u062A\u0646 \u0645\u0641\u0627\u0639\u0644\u0646 \u0641\u0639\u0644\u0646', poet_id=2
  - "Poems in metre X rhyming on \u0628" -> metre='...', rhyme='\u0628'

Notes:
  - \`metre\` must match the metre notation exactly; call ganjoor_list_rhythms to get valid values.
  - A metre with no rhyme filter returns a very large set \u2014 always page.`,
    inputSchema: z5.object({
      metre: z5.string().trim().min(1, "Metre is required").max(100).describe("Prosodic metre pattern exactly as returned by ganjoor_list_rhythms, e.g. '\u0641\u0627\u0639\u0644\u0627\u062A\u0646 \u0645\u0641\u0627\u0639\u0644\u0646 \u0641\u0639\u0644\u0646'."),
      rhyme: z5.string().trim().max(20).default("").describe("Optional rhyme letter, e.g. '\u0627' or '\u0628'. Empty matches any rhyme."),
      poet_id: z5.number().int().min(0).default(0).describe("Restrict to a poet id. 0 = all poets."),
      cat_id: z5.number().int().min(0).default(0).describe("Restrict to a category id. 0 = all categories."),
      couplet_count_min: z5.number().int().min(0).default(0).describe("Only poems with at least this many couplets. 0 disables the filter."),
      couplet_count_max: z5.number().int().min(0).default(0).describe("Only poems with at most this many couplets. 0 disables the filter."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const list = await fetchPaged("/api/ganjoor/poems/similar", input.page, input.page_size, {
      metre: input.metre,
      rhyme: input.rhyme || void 0,
      poetId: input.poet_id > 0 ? input.poet_id : void 0,
      catId: input.cat_id > 0 ? input.cat_id : void 0,
      coupletCountsFrom: input.couplet_count_min || void 0,
      coupletCountsTo: input.couplet_count_max || void 0
    });
    const poems = list.items.map((poem) => ({
      id: poem.id,
      title: poem.title,
      full_title: poem.fullTitle,
      full_url: poem.fullUrl,
      plain_text: poem.plainText ?? null
    }));
    const data = {
      metre: input.metre,
      rhyme: input.rhyme || null,
      count: poems.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      poems
    };
    return {
      data,
      markdown: () => md(`# Poems in metre "${input.metre}"${input.rhyme ? `, rhyme "${input.rhyme}"` : ""}`, `${poems.length} shown (page ${list.page})${list.has_more ? " \u2014 more available" : ""}`, "", bullets(poems.map((poem) => `${poem.full_title} \u2014 id \`${poem.id}\` \xB7 ${siteUrl(poem.full_url)}`), "no poems matched this metre and rhyme"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem_sections",
    title: "Get Poem Sections",
    description: `Get the structural sections of a poem \u2014 the stanzas (\u0628\u0646\u062F), couplets (\u0645\u062B\u0646\u0648\u06CC), and tercets (\u0631\u0628\u0627\u0639\u06CC) it is built from.

Ganjoor models a poem as nested sections so that poetry written in distinct forms within one poem
(e.g. a ghazal that closes with a qet'e) can be analysed per-section.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, section_count, sections: [{ id, index, number, section_type, verse_type, metre, rhyme }] }

Examples:
  - "What is the structure of poem 2623?" -> poem_id=2623

Notes:
  - Section \`index\` values feed directly into ganjoor_get_related_sections.`,
    inputSchema: z5.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const sections = await ganjoorGet(`/api/ganjoor/sections/${input.poem_id}`);
    const list = Array.isArray(sections) ? sections : [];
    const data = {
      poem_id: input.poem_id,
      section_count: list.length,
      sections: list.map((section) => ({
        id: section.id,
        index: section.index,
        number: section.number,
        section_type: section.sectionType,
        verse_type: section.verseType,
        metre: section.ganjoorMetre?.rhythm ?? null,
        rhyme: section.rhymeLetters ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# Sections of poem ${input.poem_id} (${list.length})`, "", bullets(list.map((section) => `index \`${section.index}\` #${section.number} \u2014 type ${section.sectionType}, metre ${section.ganjoorMetre?.rhythm ?? "\u2014"}, rhyme ${section.rhymeLetters ?? "\u2014"}`), "no sections found"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_section",
    title: "Get Poem Section",
    description: `Get one section of a poem by its section id, including its verses and its own related sections.

Args:
  - section_id (number): Section id \u2014 get these from ganjoor_get_poem_sections
  - include_verses (boolean): Include the section's verses (default: true)
  - include_related (boolean): Include related sections from other poems (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Section metadata, its metre/rhyme, optionally its verses and its related sections.

Examples:
  - "Show me section 38101" -> section_id=38101

Notes:
  - A section id differs from a poem id; use ganjoor_get_poem_sections first to map between them.
  - include_related returns up to six matches and related_has_more; use ganjoor_get_related_sections for further matches.`,
    inputSchema: z5.object({
      section_id: IdSchema.describe("Section id from ganjoor_get_poem_sections."),
      include_verses: z5.boolean().default(true).describe("Include the section's verses."),
      include_related: z5.boolean().default(false).describe("Include sections from other poems related to this one."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const response = await ganjoorGet(`/api/ganjoor/section/${input.section_id}`);
    const section = Array.isArray(response) ? response.find((item) => item.id === input.section_id) : response;
    if (!section || typeof section.poemId !== "number")
      throw new Error(`Section ${input.section_id} returned an unexpected payload.`);
    let verses = Array.isArray(section.verses) ? section.verses : [];
    if (input.include_verses && verses.length === 0) {
      const poem = await ganjoorGet(`/api/ganjoor/poem/${section.poemId}`, {
        catInfo: false,
        verseDetails: true,
        recitations: false,
        images: false,
        songs: false,
        comments: false
      });
      verses = (Array.isArray(poem.verses) ? poem.verses : []).filter((verse) => [verse.sectionIndex1, verse.sectionIndex2, verse.sectionIndex3, verse.sectionIndex4].includes(section.index));
    }
    const relatedRows = input.include_related ? await ganjoorGet(`/api/ganjoor/section/${section.poemId}/${section.index}/related`, { skip: 0, itemsCount: 7 }) : [];
    const related = relatedRows.slice(0, 6);
    const data = {
      id: section.id,
      poem_id: section.poemId,
      section_index: section.index,
      number: section.number,
      section_type: section.sectionType,
      verse_type: section.verseType,
      metre: section.ganjoorMetre?.rhythm ?? null,
      metre_id: section.ganjoorMetreId ?? null,
      rhyme: section.rhymeLetters ?? null,
      ...input.include_verses ? {
        verse_count: verses.length,
        plain_text: section.plainText ?? null,
        verses: verses.map((verse) => ({
          id: verse.id,
          position: verse.versePosition,
          text: verse.text
        }))
      } : {},
      ...input.include_related ? {
        related_count: related.length,
        related_has_more: relatedRows.length > 6,
        related_sections: related.map(relatedSectionSummary)
      } : {}
    };
    return {
      data,
      markdown: () => md(`# Section ${section.id} (poem ${section.poemId}, index ${section.index})`, `- **Metre**: ${section.ganjoorMetre?.rhythm ?? "\u2014"}`, `- **Rhyme**: ${section.rhymeLetters ?? "\u2014"}`, "", ...input.include_verses ? ["## Verses", "", ...verses.map((verse) => `[${verse.versePosition + 1}] ${verse.text}`), ""] : [], ...input.include_related && related.length ? [
        "## Related sections",
        "",
        bullets(related.map(relatedSectionSummary).map((item) => `${item.poet_name ?? "unknown poet"} \u2014 poem ${item.poem_id}, section ${item.section_index}${item.full_url ? ` \xB7 ${siteUrl(item.full_url)}` : ""}`)),
        ""
      ] : [])
    };
  });
  defineTool(server, {
    name: "ganjoor_get_related_sections",
    title: "Get Related Poem Sections",
    description: `Find sections from other poems that match a given poem section in metre and rhyme.

This is the section-level counterpart of ganjoor_find_similar_poems and is how Ganjoor links
reply-poems and cross-poet allusions at stanza granularity.

Args:
  - poem_id (number): Numeric poem id
  - section_index (number): 0-based section index within the poem (from ganjoor_get_poem_sections)
  - skip (number): Results to skip (default: 0)
  - items_count (number): How many to return. 0 or negative returns all (default: 10)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, section_index, total, skip, returned, has_more, next_skip, related_sections: [{ id, poem_id, section_index, poet_name, full_url }] }

Examples:
  - "What matches the first section of poem 2623?" -> poem_id=2623, section_index=0

Notes:
  - \`items_count=0\` returns every match, which can be thousands \u2014 prefer a bounded count.
  - total is null until the last page establishes it. id is a relationship id; poem_id and section_index refer to the target poem.`,
    inputSchema: z5.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      section_index: z5.number().int().min(0).describe("0-based section index within the poem."),
      skip: z5.number().int().min(0).default(0).describe("Results to skip for pagination."),
      items_count: z5.number().int().default(10).describe("How many related sections to return. 0 or less returns all."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet(`/api/ganjoor/section/${input.poem_id}/${input.section_index}/related`, { skip: input.skip, itemsCount: input.items_count > 0 ? input.items_count + 1 : 0 });
    const list = Array.isArray(all) ? all : [];
    const items = input.items_count > 0 ? list.slice(0, input.items_count) : list;
    const hasMore = input.items_count > 0 && list.length > input.items_count;
    const total = !hasMore && (list.length > 0 || input.skip === 0) ? input.skip + list.length : null;
    const data = {
      poem_id: input.poem_id,
      section_index: input.section_index,
      total,
      skip: input.skip,
      returned: items.length,
      has_more: hasMore,
      next_skip: hasMore ? input.skip + items.length : null,
      related_sections: items.map(relatedSectionSummary)
    };
    return {
      data,
      markdown: () => md(`# Related sections \u2014 poem ${input.poem_id}, section ${input.section_index}`, `${items.length} shown${total !== null ? ` of ${total}` : ""}${hasMore ? " \u2014 more available; increase skip" : ""}`, "", bullets(data.related_sections.map((item) => `${item.poet_name ?? "unknown poet"} \u2014 poem ${item.poem_id}, section ${item.section_index}${item.full_url ? ` \xB7 ${siteUrl(item.full_url)}` : ""}`), "no related sections found"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_couplet_sections",
    title: "Get Sections For A Couplet",
    description: `Find which structural sections a specific couplet of a poem belongs to.

A verse carries up to four nested section indices; this endpoint resolves one couplet to the
stanzas that contain it, which you need when analysing a ghazal's opening or closing section.

Args:
  - poem_id (number): Numeric poem id
  - couplet_index (number): 0-based couplet number
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, couplet_index, sections: [{ id, index, number, section_type, metre, rhyme }] }

Examples:
  - "Which section is couplet 5 of poem 2623 in?" -> poem_id=2623, couplet_index=5

Notes:
  - An empty list means the couplet index is out of range for that poem.`,
    inputSchema: z5.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      couplet_index: z5.number().int().min(0).describe("0-based couplet number."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const sections = await ganjoorGet(`/api/ganjoor/couplet/${input.poem_id}/${input.couplet_index}/sections`);
    const list = Array.isArray(sections) ? sections : [];
    const data = {
      poem_id: input.poem_id,
      couplet_index: input.couplet_index,
      sections: list.map((section) => ({
        id: section.id,
        index: section.index,
        number: section.number,
        section_type: section.sectionType,
        metre: section.ganjoorMetre?.rhythm ?? null,
        rhyme: section.rhymeLetters ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# Sections containing poem ${input.poem_id}, couplet ${input.couplet_index}`, "", bullets(list.map((section) => `index \`${section.index}\` #${section.number} \u2014 metre ${section.ganjoorMetre?.rhythm ?? "\u2014"}, rhyme ${section.rhymeLetters ?? "\u2014"}`), "no sections matched this couplet \u2014 check the couplet index"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_language_tagged_sections",
    title: "Get Language-Tagged Poem Sections",
    description: `List poem sections Ganjoor has tagged with a specific language, newest-scoped by poet.

Ganjoor tags translated or bilingual stanzas with a language code (for example \`ar\` for Arabic
quoted lines, or \`en\` for English ones). This finds those passages across the corpus.

Args:
  - language (string): Language code, e.g. 'ar' for Arabic, 'en' for English, 'fa-IR' for Persian
  - poet_id (number): Restrict to a poet id. 0 = all poets (default: 0)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { language, count, page, page_size, has_more, next_page, sections: [{ id, poem_id, section_index, poem_title, poet_name, full_url, plain_text }] }

Examples:
  - "Which passages quote Arabic?" -> language='ar'
  - "Arabic stanzas in Hafez" -> language='ar', poet_id=2

Notes:
  - Coverage is patchy: most Persian stanzas are untagged, so an empty result does not mean no
    such passage exists.
  - Each row identifies a poem and section_index; id is the poem id, not a standalone section id.`,
    inputSchema: z5.object({
      language: z5.string().trim().min(1).max(20).describe("Language code to filter by, e.g. 'ar', 'en', 'fa-IR'."),
      poet_id: z5.number().int().min(0).default(0).describe("Restrict to a poet id. 0 = all poets."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const list = await fetchPaged("/api/ganjoor/sections/tagged/language", input.page, input.page_size, {
      language: input.language,
      poetId: input.poet_id > 0 ? input.poet_id : void 0
    });
    const data = {
      language: input.language,
      count: list.items.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      sections: list.items.map((item) => ({
        id: item.id,
        poem_id: item.id,
        poem_title: item.fullTitle ?? item.title ?? null,
        poet_name: item.category?.poet?.name ?? null,
        full_url: item.fullUrl ?? null,
        plain_text: item.plainText ?? null,
        section_index: item.sectionIndex ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# Sections tagged "${input.language}" (${list.items.length} shown, page ${list.page})`, list.has_more ? "More \u2014 increase `page`." : null, "", bullets(data.sections.map((item) => `${item.poem_title ?? `poem ${item.poem_id}`}${item.poet_name ? ` \u2014 ${item.poet_name}` : ""} (poem id \`${item.poem_id}\`, section index ${item.section_index})${item.full_url ? ` \xB7 ${siteUrl(item.full_url)}` : ""}`), "no sections tagged with this language"), "")
    };
  });
}

// dist/tools/audio.js
import { z as z6 } from "zod";
function registerAudioTools(server) {
  defineTool(server, {
    name: "ganjoor_search_recitations",
    title: "Search Ganjoor Recitations",
    description: `Search the published audio recitations (\u0631\u0648\u0627\u06CC\u062A) of Ganjoor poems, optionally by reciter or poem.

Each recitation is a sung or spoken performance of one poem by a named artist, published on
ganjoor.net.

Args:
  - search_term (string): Optional text to match against the reciter's (artist's) name
  - poet_id (number): Restrict to a poet id. 0 = all poets (default: 0)
  - cat_id (number): Restrict to a category id. 0 = all categories (default: 0)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, recitations: [{ id, poem_id, poem_title, poem_url, artist, title, publish_date, duration_seconds, audio_url }] }

Examples:
  - "Any recitations by \u0645\u062D\u0645\u062F\u0631\u0636\u0627 \u0636\u06CC\u0627\u0621?" -> search_term='\u0645\u062D\u0645\u062F\u0631\u0636\u0627 \u0636\u06CC\u0627\u0621'
  - "Recitations of Hafez's ghazals" -> poet_id=2

Notes:
  - When scoped to a poet or category, results are ordered by poem id; otherwise by publish date,
    newest first.`,
    inputSchema: z6.object({
      search_term: z6.string().trim().max(200).default("").describe("Text to match against the reciter's name. Empty matches all artists."),
      poet_id: z6.number().int().min(0).default(0).describe("Restrict to a poet id. 0 = all poets."),
      cat_id: z6.number().int().min(0).default(0).describe("Restrict to a category id. 0 = all categories."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const list = await fetchPaged("/api/audio/published", input.page, input.page_size, {
      searchTerm: input.search_term || void 0,
      poetId: input.poet_id > 0 ? input.poet_id : void 0,
      catId: input.cat_id > 0 ? input.cat_id : void 0
    });
    const recitations = list.items.map((recitation) => ({
      id: recitation.id,
      poem_id: recitation.poemId,
      poem_title: recitation.poemFullTitle,
      poem_url: recitation.poemFullUrl,
      artist: recitation.audioArtist,
      title: recitation.audioTitle,
      publish_date: recitation.publishDate,
      duration_seconds: recitation.durationSeconds ?? null,
      audio_url: recitationAudioUrl(recitation)
    }));
    const data = {
      count: recitations.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      recitations
    };
    return {
      data,
      markdown: () => md(`# Recitations (${recitations.length} shown, page ${list.page})`, list.has_more ? "More \u2014 increase `page`." : null, "", bullets(recitations.map((recitation) => `${recitation.poem_title ?? `poem ${recitation.poem_id}`} \u2014 ${recitation.artist ?? "unknown artist"}${recitation.publish_date ? `, ${recitation.publish_date}` : ""} (recitation id \`${recitation.id}\`)${recitation.poem_url ? ` \xB7 ${siteUrl(recitation.poem_url)}` : ""}`), "no recitations matched"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_recitation",
    title: "Get Ganjoor Recitation",
    description: `Get one published recitation by its numeric id, including its audio file location and poem reference.

Args:
  - recitation_id (number): Recitation id (from ganjoor_search_recitations or a poem's recitation list)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { id, poem_id, poem_title, poem_url, title, artist, artist_url, audio_url, publish_date, duration_seconds, review_status }

Examples:
  - "Details for recitation 37535" -> recitation_id=37535

Notes:
  - Audio URLs point at Ganjoor's CDN and are stable once published.`,
    inputSchema: z6.object({
      recitation_id: IdSchema.describe("Numeric recitation id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const recitation = await ganjoorGet(`/api/audio/published/${input.recitation_id}`);
    const data = {
      id: recitation.id,
      poem_id: recitation.poemId,
      poem_title: recitation.poemFullTitle,
      poem_url: recitation.poemFullUrl,
      title: recitation.audioTitle,
      artist: recitation.audioArtist,
      artist_url: recitation.audioArtistUrl,
      audio_url: recitationAudioUrl(recitation),
      publish_date: recitation.publishDate,
      duration_seconds: recitation.durationSeconds ?? null,
      review_status: recitation.reviewStatus ?? null
    };
    return {
      data,
      markdown: () => md(`# Recitation ${recitation.id}`, `- **Poem**: ${recitation.poemFullTitle ?? "\u2014"}`, `- **Poem URL**: ${siteUrl(recitation.poemFullUrl) ?? "\u2014"}`, `- **Title**: ${recitation.audioTitle ?? "\u2014"}`, `- **Artist**: ${recitation.audioArtist ?? "\u2014"}${recitation.audioArtistUrl ? ` (${recitation.audioArtistUrl})` : ""}`, `- **Published**: ${date(recitation.publishDate)}`, data.audio_url ? `- **Audio**: ${data.audio_url}` : null, "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_recitation_sync_info",
    title: "Get Recitation Verse Sync Timing",
    description: `Get the per-verse timing map for a recitation, showing when each couplet begins in the audio.

Useful for following along with the text while a recitation plays.

Args:
  - recitation_id (number): Recitation id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { recitation_id, sync_point_count, total_duration_ms, sync_points: [{ verse_order, text, start_time_ms, start_time_seconds }] }

Examples:
  - "Sync data for recitation 37535" -> recitation_id=37535

Notes:
  - Not every recitation has timing data; an empty list is normal for older uploads.`,
    inputSchema: z6.object({
      recitation_id: IdSchema.describe("Numeric recitation id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const points = await ganjoorGet(`/api/audio/verses/${input.recitation_id}`);
    const markers = Array.isArray(points) ? points : [];
    const data = {
      recitation_id: input.recitation_id,
      sync_point_count: markers.length,
      total_duration_ms: markers.length > 0 ? markers[markers.length - 1].audioStartMilliseconds : null,
      sync_points: markers.map((point) => ({
        verse_order: point.verseOrder,
        text: point.verseText ?? null,
        start_time_ms: point.audioStartMilliseconds,
        start_time_seconds: typeof point.audioStartMilliseconds === "number" ? Number((point.audioStartMilliseconds / 1e3).toFixed(1)) : null
      }))
    };
    return {
      data,
      markdown: () => md(`# Verse sync \u2014 recitation ${input.recitation_id}`, `- **Sync points**: ${markers.length}`, "", bullets(data.sync_points.map((point) => `[${(point.start_time_ms / 1e3).toFixed(1)}s] verse ${point.verse_order}${point.text ? ` \u2014 ${point.text}` : ""}`), "no timing data for this recitation"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem_recitations",
    title: "Get Poem Recitations",
    description: `List every audio recitation published for one poem.

Args:
  - poem_id (number): Numeric poem id
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, count, page, page_size, has_more, next_page, recitations: [{ id, artist, title, publish_date, duration_seconds, audio_url }] }

Examples:
  - "How has poem 2623 been recited?" -> poem_id=2623

Notes:
  - Text fields are intentionally blank upstream; fetch the poem itself for its text.`,
    inputSchema: z6.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/recitations`);
    const list = Array.isArray(all) ? all : [];
    const start = (input.page - 1) * input.page_size;
    const items = list.slice(start, start + input.page_size);
    const hasMore = start + items.length < list.length;
    const data = {
      poem_id: input.poem_id,
      total: list.length,
      count: items.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      recitations: items.map((recitation) => ({
        id: recitation.id,
        artist: recitation.audioArtist,
        title: recitation.audioTitle,
        publish_date: recitation.publishDate,
        duration_seconds: recitation.durationSeconds ?? null,
        audio_url: recitationAudioUrl(recitation)
      }))
    };
    return {
      data,
      markdown: () => md(`# Recitations of poem ${input.poem_id} (${items.length} of ${list.length})`, "", bullets(data.recitations.map((recitation) => `${recitation.artist ?? "unknown artist"} \u2014 ${recitation.title ?? "untitled"}${recitation.publish_date ? `, ${recitation.publish_date}` : ""} (id \`${recitation.id}\`)${recitation.audio_url ? ` \xB7 ${recitation.audio_url}` : ""}`), "this poem has no published recitations"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_category_top_recitations",
    title: "Get Top Recitations For A Category",
    description: `Get the selected top recitation for each poem in a category \u2014 Ganjoor's "top 1" (\u0628\u0647\u062A\u0631\u06CC\u0646) listings for a book.

Args:
  - cat_id (number): Category id
  - include_poem_text (boolean): Include each poem's text (default: false)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Results per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { cat_id, total, count, page, page_size, has_more, next_page, recitations: [{ recitation_id, poem_id, poem_title, artist, audio_url, score, plain_text? }] }

Examples:
  - "The best-known recitations of Hafez's ghazals" -> find the ghazals category id, then call this

Notes:
  - One selected recitation is returned for each poem; the API does not expose a numeric score here.
  - Results are paged locally. Hafez's ghazals category is id 24.`,
    inputSchema: z6.object({
      cat_id: IdSchema.describe("Category id."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      include_poem_text: z6.boolean().default(false).describe("Include the full poem text alongside each recitation."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const result = await ganjoorGet(`/api/audio/cattop1/${input.cat_id}`, { includePoemText: input.include_poem_text });
    const all = Array.isArray(result) ? result : result?.recitations ?? [];
    const start = (input.page - 1) * input.page_size;
    const recitations = all.slice(start, start + input.page_size);
    const hasMore = start + recitations.length < all.length;
    const data = {
      cat_id: input.cat_id,
      total: all.length,
      count: recitations.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      recitations: recitations.map((recitation) => ({
        recitation_id: recitation.id,
        poem_id: recitation.poemId ?? null,
        poem_title: recitation.poemFullTitle ?? null,
        artist: recitation.audioArtist ?? null,
        audio_url: recitationAudioUrl(recitation),
        score: null,
        ...input.include_poem_text ? { plain_text: recitation.plainText ?? null } : {}
      }))
    };
    return {
      data,
      markdown: () => md(`# Top recitations in category ${input.cat_id} (${recitations.length})`, "", bullets(data.recitations.map((recitation) => `${recitation.poem_title ?? `poem ${recitation.poem_id}`} \u2014 ${recitation.artist ?? "unknown artist"}${recitation.audio_url ? ` \xB7 ${recitation.audio_url}` : ""}`), "no recitations found for this category"), "")
    };
  });
}

// dist/tools/people.js
import { z as z7 } from "zod";
var GENDER_LABEL = { 0: "unknown", 1: "male", 2: "female" };
var RELATION_KIND_LABELS = {
  0: "parent",
  1: "child",
  2: "spouse",
  3: "sibling",
  4: "grandparent",
  5: "grandchild",
  6: "uncle/aunt",
  7: "nephew/niece",
  8: "cousin",
  9: "in-law"
};
function registerPeopleTools(server) {
  defineTool(server, {
    name: "ganjoor_list_people",
    title: "List Ganjoor People",
    description: `List the historical and literary figures Ganjoor has catalogued as related persons (\u0634\u062E\u0635\u06CC\u062A\u200C\u0647\u0627).

These are people who appear in a poem's commentary or annotations \u2014 rulers, prophets, companions,
poets' contemporaries \u2014 as distinct from poets themselves.

Args:
  - search (string): Optional filter \u2014 only people whose name contains this text
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { total, count, page, page_size, has_more, next_page, people: [{ id, name, birth_year_hijri, death_year_hijri, birth_location, death_location, importance, gender }] }

Examples:
  - "Who does Ganjoor know about?" -> no arguments
  - "Find the person named '\u062D\u0627\u0641\u0638'" -> search='\u062D\u0627\u0641\u0638'

Notes:
  - Filtering is done client-side; the full list is a few hundred entries.
  - \`importance\` ranks how central the person is; higher means better documented.`,
    inputSchema: z7.object({
      search: z7.string().trim().max(200).optional().describe("Case-insensitive substring filter on the person's name."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet("/api/people");
    const people = Array.isArray(all) ? all : [];
    const filtered = input.search ? people.filter((person) => person.name.toLocaleLowerCase().includes(input.search.toLocaleLowerCase())) : people;
    const start = (input.page - 1) * input.page_size;
    const items = filtered.slice(start, start + input.page_size);
    const hasMore = start + items.length < filtered.length;
    const data = {
      total: filtered.length,
      count: items.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      people: items.map((person) => ({
        id: person.id,
        name: person.name,
        birth_year_hijri: person.validBirthDate ? person.birthYearInLHijri : null,
        death_year_hijri: person.validDeathDate ? person.deathYearInLHijri : null,
        birth_location: person.birthLocation,
        death_location: person.deathLocation,
        importance: person.importance,
        gender: GENDER_LABEL[person.gender] ?? String(person.gender),
        wiki_url: person.wikiUrl
      }))
    };
    return {
      data,
      markdown: () => md(`# Ganjoor people (${items.length} of ${filtered.length}, page ${input.page})`, hasMore ? "More \u2014 increase `page`." : null, "", bullets(items.map((person) => {
        const life = person.validBirthDate ? `${person.birthYearInLHijri} AH` : "?";
        const death = person.validDeathDate ? `${person.deathYearInLHijri} AH` : "?";
        return `${person.name} \u2014 person id \`${person.id}\`, ${life}\u2013${death}${person.birthLocation ? `, born in ${person.birthLocation}` : ""}`;
      }), "no people matched that filter"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_person",
    title: "Get Ganjoor Person",
    description: `Get one person's full record \u2014 biography, dates, places, and external references.

Args:
  - person_id (number): Numeric person id (from ganjoor_list_people)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { id, name, description, wiki_url, birth_year_hijri, death_year_hijri, birth_location, death_location, family_tree_caption, machine_generated, importance, gender }

Examples:
  - "Who is person 22?" -> person_id=22

Notes:
  - \`machine_generated\` marks entries created automatically; their biographies may be sparse.
  - Follow with ganjoor_get_person_poems or ganjoor_get_person_relations for context.`,
    inputSchema: z7.object({
      person_id: IdSchema.describe("Numeric person id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const person = await ganjoorGet(`/api/people/${input.person_id}`);
    const data = {
      id: person.id,
      name: person.name,
      description: person.description,
      wiki_url: person.wikiUrl,
      birth_year_hijri: person.validBirthDate ? person.birthYearInLHijri : null,
      death_year_hijri: person.validDeathDate ? person.deathYearInLHijri : null,
      birth_location: person.birthLocation,
      death_location: person.deathLocation,
      family_tree_caption: person.familyTreeCaption,
      machine_generated: person.machineGenerated,
      importance: person.importance,
      gender: GENDER_LABEL[person.gender] ?? String(person.gender)
    };
    return {
      data,
      markdown: () => md(`# ${person.name} (person id ${person.id})`, `- **Born**: ${person.validBirthDate ? `${person.birthYearInLHijri} AH (\u2248 ${hijriToGregorianApprox(person.birthYearInLHijri)} CE)${person.birthLocation ? ` in ${person.birthLocation}` : ""}` : "unknown"}`, `- **Died**: ${person.validDeathDate ? `${person.deathYearInLHijri} AH (\u2248 ${hijriToGregorianApprox(person.deathYearInLHijri)} CE)${person.deathLocation ? ` in ${person.deathLocation}` : ""}` : "unknown"}`, `- **Gender**: ${GENDER_LABEL[person.gender] ?? person.gender}`, person.wikiUrl ? `- **Reference**: ${person.wikiUrl}` : null, "", ...person.description ? ["## Description", "", person.description, ""] : [])
    };
  });
  defineTool(server, {
    name: "ganjoor_get_person_poems",
    title: "Get Poems Tagged With A Person",
    description: `Get every poem Ganjoor has tagged with a given person.

This is the strongest link between a historical figure and the poetry about them.

Args:
  - person_id (number): Numeric person id
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { person_id, total, count, page, page_size, has_more, next_page, poems: [{ id, tag_id, title, full_title, full_url, couplet_index, couplet_text }] }

Examples:
  - "Which poems mention this figure?" -> person_id=<id>

Notes:
  - Tagging is curated and incomplete for older figures.`,
    inputSchema: z7.object({
      person_id: IdSchema.describe("Numeric person id."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet(`/api/people/${input.person_id}/poems`);
    const poems = Array.isArray(all) ? all : [];
    const start = (input.page - 1) * input.page_size;
    const items = poems.slice(start, start + input.page_size);
    const hasMore = start + items.length < poems.length;
    const data = {
      person_id: input.person_id,
      total: poems.length,
      count: items.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      poems: items.map((tag) => ({
        id: tag.poemId ?? tag.poem?.id ?? null,
        tag_id: tag.id,
        title: tag.poem?.title ?? null,
        full_title: tag.poem?.fullTitle ?? null,
        full_url: tag.poem?.fullUrl ?? null,
        couplet_index: tag.coupletIndex ?? null,
        couplet_text: tag.coupletText ?? null
      }))
    };
    return {
      data,
      markdown: () => md(`# Poems tagged with person ${input.person_id} (${items.length} of ${poems.length})`, "", bullets(data.poems.map((poem) => `${poem.title ?? "untitled"} \u2014 poem id \`${poem.id}\`${poem.full_url ? ` \xB7 ${poem.full_url}` : ""}`), "no poems are tagged with this person"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_person_relations",
    title: "Get Person Relations",
    description: `Get a person's kinship and affiliation edges \u2014 parents, siblings, spouses, teachers, and contemporaries.

Args:
  - person_id (number): Numeric person id
  - relation_type (string): Optional filter \u2014 only relations of this kind, e.g. 'father', 'son', 'spouse', 'student', 'teacher'
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { person_id, relation_count, relations: [{ id, from_person_id, from_person_name, to_person_id, to_person_name, relation_kind, relation_name }] }

Examples:
  - "Who was this person's teacher?" -> person_id=<id>, relation_type='teacher'

Notes:
  - Edges are stored undirected with a kind; the same edge appears once.
  - Use ganjoor_get_person_family_tree for the whole connected component.`,
    inputSchema: z7.object({
      person_id: IdSchema.describe("Numeric person id."),
      relation_type: z7.string().trim().max(60).optional().describe("Optional filter on the relation kind, e.g. 'father', 'spouse', 'teacher'."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const result = await ganjoorGet(`/api/people/${input.person_id}/relations`);
    const subject = result?.person;
    const all = result?.relations ?? [];
    const affiliations = result?.affiliations ?? [];
    const label = (relationType) => RELATION_KIND_LABELS[relationType] ?? `type ${relationType}`;
    const edges = [
      ...all.map((relation) => ({
        kind: "kinship",
        relation_type: relation.relationType,
        relation_label: label(relation.relationType),
        other_person_id: relation.otherPersonId,
        other_person_name: relation.otherPersonName,
        note: relation.note ?? null,
        evidence_count: (relation.evidence ?? []).length,
        evidence_poem_ids: (relation.evidence ?? []).map((item) => item.poemId).filter((id) => typeof id === "number")
      })),
      ...affiliations.map((affiliation) => ({
        kind: "affiliation",
        relation_type: affiliation.affiliationType,
        relation_label: "affiliation",
        other_person_id: affiliation.otherPersonId,
        other_person_name: affiliation.otherPersonName,
        note: affiliation.note ?? null,
        evidence_count: 0,
        evidence_poem_ids: []
      }))
    ];
    const relations = input.relation_type ? edges.filter((edge) => `${edge.relation_label} ${edge.relation_type}`.toLocaleLowerCase().includes(input.relation_type.toLocaleLowerCase())) : edges;
    const data = {
      person_id: input.person_id,
      person_name: subject?.name ?? null,
      relation_count: relations.length,
      relations: relations.map((edge) => ({
        kind: edge.kind,
        relation_type: edge.relation_type,
        relation_label: edge.relation_label,
        other_person_id: edge.other_person_id,
        other_person_name: edge.other_person_name,
        note: edge.note,
        evidence_count: edge.evidence_count,
        evidence_poem_ids: edge.evidence_poem_ids
      }))
    };
    return {
      data,
      markdown: () => md(`# Relations of ${data.person_name ?? `person ${input.person_id}`} (${relations.length})`, "", bullets(relations.map((edge) => `${edge.relation_label} \u2014 ${edge.other_person_name ?? `person ${edge.other_person_id}`}` + (edge.evidence_count ? ` (${edge.evidence_count} citing verses)` : null)), "no relations recorded"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_person_family_tree",
    title: "Get Person Family Tree",
    description: `Get the full connected kinship component reachable from a person \u2014 ancestors, descendants, spouses, and siblings.

This returns the whole clan cluster, not just one hop, which makes it the right tool for tracing a
figure's lineage across generations.

Args:
  - person_id (number): Numeric person id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { person_id, root_id, person_count, people: [{ id, name, birth_year_hijri, death_year_hijri, family_tree_caption }], relation_count, relations: [{ person1_id, person1_name, person2_id, person2_name, relation_label }] }

Examples:
  - "Show me this figure's lineage" -> person_id=<id>

Notes:
  - Components can be large for well-documented dynasties (the Kayumars tree has ~56 people).
  - Data quality varies: some edges are machine-generated and may be speculative \u2014 check the
    machine_generated flag per person.`,
    inputSchema: z7.object({
      person_id: IdSchema.describe("Numeric person id to start the traversal from."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const tree = await ganjoorGet(`/api/people/${input.person_id}/familytree`);
    const persons = tree?.persons ?? [];
    const relations = tree?.relations ?? [];
    const nameById = new Map(persons.map((person) => [person.id, person.name]));
    const data = {
      person_id: input.person_id,
      root_id: tree?.rootId ?? null,
      person_count: persons.length,
      people: persons.map((person) => ({
        id: person.id,
        name: person.name,
        birth_year_hijri: person.validBirthDate ? person.birthYearInLHijri : null,
        death_year_hijri: person.validDeathDate ? person.deathYearInLHijri : null,
        birth_location: person.birthLocation,
        death_location: person.deathLocation,
        family_tree_caption: person.familyTreeCaption,
        machine_generated: person.machineGenerated
      })),
      relation_count: relations.length,
      relations: relations.map((relation) => ({
        person1_id: relation.person1Id,
        person1_name: nameById.get(relation.person1Id) ?? null,
        person2_id: relation.person2Id,
        person2_name: nameById.get(relation.person2Id) ?? null,
        relation_label: RELATION_KIND_LABELS[relation.relationType] ?? `type ${relation.relationType}`
      }))
    };
    return {
      data,
      markdown: () => md(`# Family tree from person ${input.person_id} \u2014 ${persons.length} people, ${relations.length} relations`, "", bullets(data.people.map((person) => `${person.name} \u2014 id \`${person.id}\`${person.birth_year_hijri ? `, ${person.birth_year_hijri} AH` : ""}`), "no family data available for this person"))
    };
  });
}
function registerCommentAndFaqTools(server) {
  defineTool(server, {
    name: "ganjoor_get_recent_comments",
    title: "Get Recent Ganjoor Comments",
    description: `Get the most recent published reader comments across Ganjoor, optionally filtered.

Comments are scholarly notes attached to a specific couplet of a poem.

Args:
  - term (string): Optional text filter applied to comment bodies
  - filter_user_id (string): Optional UUID \u2014 only comments by this user
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, page, page_size, has_more, next_page, comments: [{ id, poem_id, poem_title, couplet_index, user, text, date, has_owner_response }] }

Examples:
  - "What are people discussing?" -> no arguments
  - "Comments about '\u0627\u0646\u062A\u0638\u0627\u0631'" -> term='\u0627\u0646\u062A\u0638\u0627\u0631'

Notes:
  - Ordering is by recency, so results change over time \u2014 not suitable for questions whose answer
    must stay stable.
  - Replies are not included, only top-level comments.`,
    inputSchema: z7.object({
      term: z7.string().trim().max(200).optional().describe("Optional substring filter applied to comment text."),
      filter_user_id: z7.string().trim().uuid().optional().describe("Optional user UUID \u2014 only that user's comments."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const list = await fetchPaged("/api/ganjoor/comments", input.page, input.page_size, {
      term: input.term,
      filterUserId: input.filter_user_id
    });
    const comments = list.items.map(commentSummary);
    const data = {
      count: comments.length,
      page: list.page,
      page_size: list.page_size,
      has_more: list.has_more,
      next_page: list.next_page,
      comments
    };
    const commentBlocks = comments.map((comment) => md(`## ${comment.poem_title ?? `poem ${comment.poem_id}`}${comment.couplet_index !== null && comment.couplet_index >= 0 ? ` \u2014 couplet ${comment.couplet_index + 1}` : ""}`, `- **By**: ${comment.user ?? "anonymous"} \xB7 **Date**: ${comment.date ?? "\u2014"}`, "", comment.text ?? "", ""));
    return {
      data,
      markdown: () => md(`# Recent comments (${comments.length}, page ${list.page})`, list.has_more ? "More \u2014 increase `page`." : null, "", ...commentBlocks)
    };
  });
  defineTool(server, {
    name: "ganjoor_list_faq_categories",
    title: "List Ganjoor FAQ Categories",
    description: `List the Ganjoor site's published FAQ (\u067E\u0631\u0633\u0634\u200C\u0647\u0627\u06CC \u0645\u062A\u062F\u0627\u0648\u0644) categories.

These are editorial explanations of how Ganjoor works \u2014 text sourcing, version differences,
contribution rules.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { count, categories: [{ id, title, description, item_count }] }

Examples:
  - "What topics does Ganjoor's FAQ cover?" -> no arguments

Notes:
  - Follow up with ganjoor_get_faq_items using a category id.`,
    inputSchema: z7.object({ response_format: ResponseFormatSchema }).strict(),
    annotations: READ_ONLY
  }, async () => {
    const categories = await ganjoorGet("/api/faq/cat");
    const list = Array.isArray(categories) ? categories : [];
    const data = {
      count: list.length,
      categories: list.map((category) => ({
        id: category.id,
        title: category.title,
        description: category.description,
        item_count: Array.isArray(category.items) ? category.items.length : null
      }))
    };
    const categoryBlocks = list.map((category) => md(`## ${category.title} (id \`${category.id}\`)`, category.description ?? ""));
    return {
      data,
      markdown: () => md(`# Ganjoor FAQ categories (${list.length})`, "", categoryBlocks.join("\n\n"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_faq_items",
    title: "Get Ganjoor FAQ Items",
    description: `Get every published question-and-answer in a Ganjoor FAQ category.

Args:
  - cat_id (number): FAQ category id (from ganjoor_list_faq_categories)
  - page (number): Page number, starting from 1 (default: 1)
  - page_size (number): Items per page, 1-100 (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { cat_id, total, count, page, page_size, has_more, next_page, items: [{ id, question, answer, answer_excerpt }] }

Examples:
  - "How does Ganjoor decide which text to use?" -> cat_id=<id>, then read the answers

Notes:
  - Answers are Persian prose and may contain HTML markup from the source; return them verbatim.
  - Despite its name, answerExcerpt carries the complete body \u2014 fullAnswer is always empty upstream.`,
    inputSchema: z7.object({
      cat_id: IdSchema.describe("FAQ category id."),
      page: PaginationSchema.shape.page,
      page_size: PaginationSchema.shape.page_size,
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const all = await ganjoorGet("/api/faq/cat/items", { catId: input.cat_id });
    const items = Array.isArray(all) ? all : [];
    const start = (input.page - 1) * input.page_size;
    const pageItems = items.slice(start, start + input.page_size);
    const hasMore = start + pageItems.length < items.length;
    const data = {
      cat_id: input.cat_id,
      total: items.length,
      count: pageItems.length,
      page: input.page,
      page_size: input.page_size,
      has_more: hasMore,
      next_page: hasMore ? input.page + 1 : null,
      items: pageItems.map((item) => ({
        id: item.id,
        question: item.question,
        answer: item.answerExcerpt ?? item.fullAnswer ?? null,
        answer_excerpt: item.answerExcerpt ?? null
      }))
    };
    const itemBlocks = pageItems.map((item) => md(`## ${item.question}`, "", item.answerExcerpt ?? item.fullAnswer ?? null));
    return {
      data,
      markdown: () => md(`# FAQ items in category ${input.cat_id} (${pageItems.length} of ${items.length})`, "", itemBlocks.join("\n\n"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_faq_item",
    title: "Get Ganjoor FAQ Item",
    description: `Get one Ganjoor FAQ entry by its numeric id.

Args:
  - faq_id (number): FAQ item id (from ganjoor_get_faq_items)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { id, category_id, question, answer, answer_excerpt, pinned }

Examples:
  - "Show FAQ item 7" -> faq_id=7

Notes:
  - Despite its name, answerExcerpt carries the complete body; fullAnswer is always empty upstream.
  - Only published items are served. An upstream 500 usually means the id does not exist \u2014 re-check
    the id from ganjoor_get_faq_items.`,
    inputSchema: z7.object({
      faq_id: IdSchema.describe("Numeric FAQ item id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const item = await ganjoorGet(`/api/faq/${input.faq_id}`);
    const answer = item.answerExcerpt ?? item.fullAnswer ?? null;
    const data = {
      id: item.id,
      category_id: item.categoryId,
      question: item.question,
      answer,
      answer_excerpt: item.answerExcerpt ?? null,
      pinned: item.pinned ?? false
    };
    return {
      data,
      markdown: () => md(`## ${item.question}`, "", answer ?? "This FAQ entry has no answer text.")
    };
  });
}

// dist/tools/content.js
import { z as z8 } from "zod";
function registerContentTools(server) {
  defineTool(server, {
    name: "ganjoor_get_poem_images",
    title: "Get Poem Manuscript Images",
    description: `Get the manuscript and facsimile images Ganjoor holds for a poem.

These link to physical manuscripts, with a thumbnail and the source museum page per image.
The current API supplies thumbnailImageUrl and targetPageUrl, not a direct full-resolution file.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, image_count, images: [{ id, url, full_image_url, thumbnail_url, page_url, alt, description, is_original_source }] }

Examples:
  - "Show the manuscript for poem 2623" -> poem_id=2623

Notes:
  - Most poems have no images; an empty list is the normal case.`,
    inputSchema: z8.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const images = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/images`);
    const list = Array.isArray(images) ? images : [];
    const data = {
      poem_id: input.poem_id,
      image_count: list.length,
      images: list.map(imageSummary)
    };
    return {
      data,
      markdown: () => md(`# Images for poem ${input.poem_id} (${list.length})`, "", bullets(data.images.map((image) => `${image.alt ?? `image ${image.id}`}${image.url ? ` \u2014 image: ${siteUrl(image.url)}` : ""}${image.page_url ? ` \xB7 source page: ${image.page_url}` : ""}`), "this poem has no manuscript images"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem_quoted_poems",
    title: "Get Poems Quoted By A Poem",
    description: `Get the poems that a given poem quotes or alludes to, and the poems that quote it.

Matching in metre and rhyme is common in Persian poetry \u2014 poets answer each other by reusing the
other's metre and rhyme. This endpoint maps those links in both directions.

Args:
  - poem_id (number): Numeric poem id
  - only_both_poems (boolean): Only keep pairs where both poems claim the quotation (default: false)
  - published_only (boolean): Only keep published records (default: true)
  - main_list_only (boolean): Only keep records curated onto the main "related poems" list (default: false)
  - skip (number): Results to skip (default: 0)
  - items_count (number): How many to return. 0 or negative returns all (default: 20)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, total, returned, quotes: [{ id, related_poem_id, related_poet_name, related_poem_title, related_poem_url, is_prior, quoted_couplet, quoting_couplet, claimed_by_both, note }] }

Examples:
  - "Which poems does this one answer?" -> poem_id=<id>

Notes:
  - Each record pairs the quoted couplet with the couplet in the other poem that quotes it, so the
    actual verbal borrowing is visible.
  - \`is_prior: true\` means this poem came first chronologically.
  - \`items_count=0\` returns everything, which can be large.`,
    inputSchema: z8.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      only_both_poems: z8.boolean().default(false).describe("Only include quotations both poems acknowledge."),
      published_only: z8.boolean().default(true).describe("Only include published records."),
      main_list_only: z8.boolean().default(false).describe("Only include records curated onto the main related-poems list."),
      skip: z8.number().int().min(0).default(0).describe("Results to skip."),
      items_count: z8.number().int().default(20).describe("How many results to return. 0 or less returns all."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const quotes = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/quoteds`, {
      skip: input.skip,
      itemsCount: input.items_count,
      onlyClaimedByBothPoets: input.only_both_poems,
      published: input.published_only,
      chosenForMainList: input.main_list_only
    });
    const list = Array.isArray(quotes) ? quotes : [];
    const data = {
      poem_id: input.poem_id,
      total: list.length,
      returned: list.length,
      quotes: list.map((quote) => ({
        id: quote.id,
        related_poem_id: quote.relatedPoemId,
        related_poet_name: quote.cachedRelatedPoemPoetName,
        related_poem_title: quote.cachedRelatedPoemFullTitle,
        related_poem_url: quote.cachedRelatedPoemFullUrl,
        is_prior: quote.isPriorToRelated,
        quoted_couplet: quote.coupletVerse1 && quote.coupletVerse2 ? `${quote.coupletVerse1} / ${quote.coupletVerse2}` : quote.coupletVerse1 ?? quote.relatedCoupletVerse1,
        quoting_couplet: quote.relatedCoupletVerse1 && quote.relatedCoupletVerse2 ? `${quote.relatedCoupletVerse1} / ${quote.relatedCoupletVerse2}` : quote.relatedCoupletVerse1 ?? quote.coupletVerse1,
        claimed_by_both: quote.claimedByBothPoets,
        chosen_for_main_list: quote.chosenForMainList,
        note: quote.note
      }))
    };
    return {
      data,
      markdown: () => md(`# Poems quoting poem ${input.poem_id} (${list.length})`, "", bullets(list.map((quote) => `${quote.cachedRelatedPoemPoetName ?? "unknown poet"} \u2014 ${quote.cachedRelatedPoemFullTitle ?? `poem ${quote.relatedPoemId}`} (id \`${quote.relatedPoemId}\`)` + (quote.cachedRelatedPoemFullUrl ? ` \xB7 ${siteUrl(quote.cachedRelatedPoemFullUrl)}` : "")), "no poems are recorded as quoting this poem"))
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem_effective_corrections",
    title: "Get Poem Text Corrections",
    description: `Get the editorial corrections applied to a poem's text \u2014 the before/after record of every fix.

Useful for understanding why the text on Ganjoor differs from an older printed edition.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, correction_count, corrections: [{ id, verse_order, text, original_text }] }

Examples:
  - "What corrections were made to poem 2623?" -> poem_id=2623

Notes:
  - Each entry pairs the corrected text with the original, per verse order.`,
    inputSchema: z8.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const corrections = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/corrections/effective`);
    const list = Array.isArray(corrections) ? corrections : [];
    const flat = list.flatMap((correction) => (correction.verseOrderText ?? []).map((verse) => ({
      correction_id: correction.id,
      verse_id: verse.id ?? null,
      verse_order: verse.voRder ?? null,
      text: verse.text ?? null,
      original_text: verse.originalText ?? null
    })));
    const data = {
      poem_id: input.poem_id,
      correction_count: list.length,
      corrected_verse_count: flat.length,
      corrections: flat
    };
    return {
      data,
      markdown: () => md(`# Corrections applied to poem ${input.poem_id} (${flat.length} corrected verses)`, "", bullets(flat.map((item) => `verse ${item.verse_order ?? "?"}: "${item.original_text ?? "\u2014"}" \u2192 "${item.text ?? "\u2014"}"`), "no corrections have been applied to this poem"), "")
    };
  });
  defineTool(server, {
    name: "ganjoor_get_poem_geotags",
    title: "Get Poem Geo Tags",
    description: `Get the geographic and historical locations tagged to a single poem.

A geo tag pins a poem to a place and to the Hijri/Gregorian date it commemorates \u2014 for instance a
poem about a battle fought at a named site.

Args:
  - poem_id (number): Numeric poem id
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON: { poem_id, tag_count, tags: [{ id, latitude, longitude, lunar_date, gregorian_date }] }

Examples:
  - "Where is the event in poem 2623?" -> poem_id=2623

Notes:
  - For a whole diwan, use ganjoor_get_category_geotags instead.`,
    inputSchema: z8.object({
      poem_id: IdSchema.describe("Numeric poem id."),
      response_format: ResponseFormatSchema
    }).strict(),
    annotations: READ_ONLY
  }, async (args) => {
    const input = args;
    const tags = await ganjoorGet(`/api/ganjoor/poem/${input.poem_id}/geotag`);
    const list = Array.isArray(tags) ? tags : [];
    const data = {
      poem_id: input.poem_id,
      tag_count: list.length,
      tags: list.map(geoTagSummary)
    };
    return {
      data,
      markdown: () => md(`# Geo tags for poem ${input.poem_id} (${list.length})`, "", bullets(data.tags.map((tag) => {
        const coords = tag.latitude !== null && tag.latitude !== void 0 ? `${tag.latitude}, ${tag.longitude}` : "no coordinates";
        return `${tag.location_name ?? "unnamed location"} [${tag.lunar_date ?? tag.lunar_year ?? "undated"} / ${tag.gregorian_date ?? "\u2014"}] \u2014 ${coords}`;
      }), "this poem has no geo tags"), "")
    };
  });
}

// dist/server.js
function createServer() {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
    title: "Ganjoor Poetry"
  }, {
    instructions: SERVER_INSTRUCTIONS
  });
  registerPoetTools(server);
  registerCategoryTools(server);
  registerPoemTools(server);
  registerAnalysisTools(server);
  registerAudioTools(server);
  registerPeopleTools(server);
  registerCommentAndFaqTools(server);
  registerContentTools(server);
  return server;
}

// cloudflare-adapter.mjs
var app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>\u06AF\u0646\u062C\u0648\u0631 \u2014 \u0646\u0633\u062E\u0647\u0654 \u0627\u0635\u0644\u0627\u062D\u200C\u0634\u062F\u0647\u0654 \u06F1\u066B\u06F0\u066B\u06F1</title><style>body{max-width:750px;margin:48px auto;padding:24px;font:18px/1.8 system-ui;background:#faf8f3;color:#242424}code{direction:ltr;display:block;overflow-wrap:anywhere;padding:16px;background:#fff;border:1px solid #ddd}button{font:inherit;padding:8px 14px;margin:10px;cursor:pointer}li{overflow-wrap:anywhere}</style>
<h1>\u0627\u062A\u0635\u0627\u0644 \u06AF\u0646\u062C\u0648\u0631 \u2014 \u0646\u0633\u062E\u0647\u0654 \u0627\u0635\u0644\u0627\u062D\u200C\u0634\u062F\u0647\u0654 \u06F1\u066B\u06F0\u066B\u06F1</h1><p>\u06F4\u06F4 \u0627\u0628\u0632\u0627\u0631 \u06AF\u0646\u062C\u0648\u0631\u060C \u0628\u0627 \u0627\u0635\u0644\u0627\u062D \u0644\u06CC\u0646\u06A9 \u0635\u0648\u062A\u060C \u062A\u0635\u0648\u06CC\u0631\u060C \u062D\u0627\u0634\u06CC\u0647\u200C\u0647\u0627 \u0648 \u0635\u0641\u062D\u0647\u200C\u0628\u0646\u062F\u06CC.</p>
<p>\u0646\u0634\u0627\u0646\u06CC \u0627\u062A\u0635\u0627\u0644 MCP:</p><code id="endpoint"></code><button id="copy">\u06A9\u067E\u06CC \u0646\u0634\u0627\u0646\u06CC \u0627\u062A\u0635\u0627\u0644</button>
<button id="test">\u0646\u0645\u0627\u06CC\u0634 \u0627\u0628\u0632\u0627\u0631\u0647\u0627\u06CC \u062B\u0628\u062A\u200C\u0634\u062F\u0647</button><button id="check">\u0622\u0632\u0645\u0648\u0646 \u0686\u0646\u062F \u0642\u0627\u0628\u0644\u06CC\u062A</button><p id="status"></p><ol id="tools"></ol><ol id="checks"></ol>
<p>\u0646\u0645\u0627\u06CC\u0634 \u0627\u0628\u0632\u0627\u0631\u0647\u0627 \u0641\u0642\u0637 \u062B\u0628\u062A\u200C\u0634\u062F\u0646 \u0622\u0646\u200C\u0647\u0627 \u0631\u0627 \u0628\u0631\u0631\u0633\u06CC \u0645\u06CC\u200C\u06A9\u0646\u062F. \u0628\u0631\u0627\u06CC \u0628\u0631\u0631\u0633\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F\u060C \u062C\u0633\u062A\u062C\u0648 \u0648 \u062E\u0648\u0627\u0646\u062F\u0646 \u0634\u0639\u0631 \u0631\u0627 \u0628\u0627 \u067E\u0627\u0633\u062E \u0648\u0627\u0642\u0639\u06CC \u0627\u0645\u062A\u062D\u0627\u0646 \u06A9\u0646\u06CC\u062F.</p>
<p>\u062C\u0633\u062A\u062C\u0648\u06CC \u0645\u0639\u0646\u0627\u06CC\u06CC \u0628\u0647 \u0641\u0639\u0627\u0644\u200C\u0628\u0648\u062F\u0646 \u0633\u0631\u0648\u06CC\u0633 \u0622\u0646 \u062F\u0631 \u06AF\u0646\u062C\u0648\u0631 \u0648\u0627\u0628\u0633\u062A\u0647 \u0627\u0633\u062A. \u0627\u0645\u06A9\u0627\u0646\u0627\u062A \u062D\u0633\u0627\u0628 \u0634\u062E\u0635\u06CC \u0648 \u0646\u0648\u0634\u062A\u0646 \u062F\u0631 \u06AF\u0646\u062C\u0648\u0631 \u062C\u0632\u0648 \u0627\u0628\u0632\u0627\u0631\u0647\u0627\u06CC \u0631\u0633\u0645\u06CC \u0627\u06CC\u0646 \u0633\u0631\u0648\u0631 \u0646\u06CC\u0633\u062A\u0646\u062F.</p>
<script>
const endpoint=location.origin+'/mcp';
document.getElementById('endpoint').textContent=endpoint;
document.getElementById('copy').onclick=async()=>{try{await navigator.clipboard.writeText(endpoint);document.getElementById('status').textContent='\u0646\u0634\u0627\u0646\u06CC \u06A9\u067E\u06CC \u0634\u062F.'}catch{document.getElementById('status').textContent='\u0646\u0634\u0627\u0646\u06CC \u0628\u0627\u0644\u0627 \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u0648 \u06A9\u067E\u06CC \u06A9\u0646\u06CC\u062F.'}};
async function rpc(body,version){const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'};if(version)headers['MCP-Protocol-Version']=version;const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});if(!r.ok)throw new Error('HTTP '+r.status);const data=await r.json();if(data.error)throw new Error(data.error.message);return data.result;}
document.getElementById('test').onclick=async()=>{
 const status=document.getElementById('status');const list=document.getElementById('tools');list.replaceChildren();status.textContent='\u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0631\u0633\u06CC\u2026';
 try{
  const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ganjoor-worker-check',version:'1.0.0'}}});
  const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':init.protocolVersion};
  const notification=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  if(!notification.ok)throw new Error('Notification HTTP '+notification.status);
  let cursor;const tools=[];
  do{const result=await rpc({jsonrpc:'2.0',id:2,method:'tools/list',params:cursor?{cursor}:{}},init.protocolVersion);tools.push(...result.tools);cursor=result.nextCursor;}while(cursor);
  const essential=['ganjoor_search_poems','ganjoor_semantic_search_poems','ganjoor_get_poem','ganjoor_get_poem_recitations','ganjoor_analyze_poem_rhyme'];
  const missing=essential.filter(name=>!tools.some(tool=>tool.name===name));
  status.textContent=tools.length+' \u0627\u0628\u0632\u0627\u0631 \u062B\u0628\u062A \u0634\u062F\u0647 \u0627\u0633\u062A.'+(missing.length?' \u0627\u0628\u0632\u0627\u0631\u0647\u0627\u06CC \u0645\u0648\u0631\u062F \u0627\u0646\u062A\u0638\u0627\u0631 \u067E\u06CC\u062F\u0627 \u0646\u0634\u062F\u0646\u062F: '+missing.join(', '):' \u0627\u0628\u0632\u0627\u0631\u0647\u0627\u06CC \u062C\u0633\u062A\u062C\u0648\u060C \u0634\u0639\u0631\u060C \u062E\u0648\u0627\u0646\u0634 \u0648 \u0642\u0627\u0641\u06CC\u0647 \u062F\u0631 \u0641\u0647\u0631\u0633\u062A \u0647\u0633\u062A\u0646\u062F.');
  for(const tool of tools){const li=document.createElement('li');li.textContent=tool.name;li.dir='ltr';list.appendChild(li)}
 }catch(error){status.textContent='\u0628\u0631\u0631\u0633\u06CC \u0645\u0648\u0641\u0642 \u0646\u0634\u062F: '+error.message;}
};

document.getElementById('check').onclick=async()=>{
 const button=document.getElementById('check');const status=document.getElementById('status');const list=document.getElementById('checks');list.replaceChildren();button.disabled=true;status.textContent='\u062F\u0631 \u062D\u0627\u0644 \u0622\u0632\u0645\u0627\u06CC\u0634 \u067E\u0627\u0633\u062E\u200C\u0647\u0627\u06CC \u0648\u0627\u0642\u0639\u06CC\u2026';
 const tests=[
  {label:'\u0644\u06CC\u0646\u06A9 \u0635\u0648\u062A',name:'ganjoor_get_recitation',args:{recitation_id:2840},valid:d=>/^https?:/.test(d.audio_url||'')},
  {label:'\u062A\u0635\u0627\u0648\u06CC\u0631 \u0648 \u0635\u0641\u062D\u0647\u0654 \u0645\u0646\u0628\u0639',name:'ganjoor_get_poem_images',args:{poem_id:2130},valid:d=>d.images?.length>0&&d.images.every(i=>i.thumbnail_url&&i.page_url)},
  {label:'\u0645\u062A\u0646 \u062D\u0627\u0634\u06CC\u0647\u200C\u0647\u0627',name:'ganjoor_get_recent_comments',args:{page_size:1},valid:d=>d.comments?.[0]?.text&&d.comments[0].user&&d.comments[0].poem_url},
  {label:'\u062E\u0648\u0627\u0646\u0634\u200C\u0647\u0627\u06CC \u0628\u0631\u062A\u0631',name:'ganjoor_get_category_top_recitations',args:{cat_id:24,page_size:1},valid:d=>d.total>0&&d.recitations?.[0]?.audio_url},
  {label:'\u0646\u0627\u0645 \u0648 \u0645\u062E\u062A\u0635\u0627\u062A \u0645\u06A9\u0627\u0646\u200C\u0647\u0627',name:'ganjoor_get_category_geotags',args:{cat_id:9},valid:d=>d.tags?.some(t=>t.location_name&&Number.isFinite(t.latitude)&&Number.isFinite(t.longitude))},
  {label:'\u0645\u062A\u0646 \u0628\u062E\u0634 \u0634\u0639\u0631',name:'ganjoor_get_section',args:{section_id:37608},valid:d=>d.verse_count===14&&d.verses?.length===14},
  {label:'\u0634\u0639\u0631 \u0648 \u0648\u0632\u0646 \u062B\u0628\u062A\u200C\u0634\u062F\u0647',name:'ganjoor_get_poem_by_id',args:{poem_id:2130},valid:d=>d.id===2130&&d.metre?.rhythm&&d.metre_source==='stored'},
  {label:'\u062C\u0633\u062A\u062C\u0648\u06CC \u0633\u0631\u0627\u0633\u0631\u06CC',name:'ganjoor_search_poems',args:{term:'\u0635\u0628\u0631',poet_id:0,cat_id:0,page:1,page_size:3,include_text:true},valid:d=>d.poems?.length===3&&d.poems.every(p=>p.plain_text?.includes('\u0635\u0628\u0631'))}
 ];
 let ok=0;
 try{
  const init=await rpc({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'ganjoor-functional-check',version:'1.0.1'}}});
  const notification=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','MCP-Protocol-Version':init.protocolVersion},body:JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})});
  if(!notification.ok)throw new Error('Notification HTTP '+notification.status);
  for(let i=0;i<tests.length;i++){
   const test=tests[i];const li=document.createElement('li');li.textContent=test.label+' \u2014 \u062F\u0631 \u062D\u0627\u0644 \u0628\u0631\u0631\u0633\u06CC\u2026';list.appendChild(li);
   try{
    const result=await rpc({jsonrpc:'2.0',id:i+10,method:'tools/call',params:{name:test.name,arguments:{...test.args,response_format:'json'}}},init.protocolVersion);
    if(result.isError)throw new Error((result.content||[]).find(c=>c.type==='text')?.text||'\u062E\u0637\u0627\u06CC \u0627\u0628\u0632\u0627\u0631');
    const data=result.structuredContent||JSON.parse(result.content.find(c=>c.type==='text').text);
    if(!test.valid(data))throw new Error('\u067E\u0627\u0633\u062E \u0631\u0633\u06CC\u062F \u0648\u0644\u06CC \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u0645\u0648\u0631\u062F \u0627\u0646\u062A\u0638\u0627\u0631 \u06A9\u0627\u0645\u0644 \u0646\u06CC\u0633\u062A.');
    ok++;li.textContent=test.label+' \u2014 \u062F\u0631\u0633\u062A \u06A9\u0627\u0631 \u06A9\u0631\u062F';li.style.color='#157347';
   }catch(error){li.textContent=test.label+' \u2014 '+error.message;li.style.color='#ad2424';}
  }
  status.textContent=ok+' \u0645\u0648\u0631\u062F \u0627\u0632 '+tests.length+' \u0622\u0632\u0645\u0627\u06CC\u0634 \u0646\u0645\u0648\u0646\u0647\u200C\u0627\u06CC \u0645\u0648\u0641\u0642 \u0628\u0648\u062F. \u0627\u06CC\u0646 \u0628\u0631\u0631\u0633\u06CC \u0647\u0645\u0647\u0654 \u0648\u0631\u0648\u062F\u06CC\u200C\u0647\u0627\u06CC \u06F4\u06F4 \u0627\u0628\u0632\u0627\u0631 \u0631\u0627 \u067E\u0648\u0634\u0634 \u0646\u0645\u06CC\u200C\u062F\u0647\u062F.';
 }catch(error){status.textContent='\u0622\u0632\u0645\u0648\u0646 \u0634\u0631\u0648\u0639 \u0646\u0634\u062F: '+error.message;}finally{button.disabled=false;}
};

</script></html>`);
});
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: void 0,
    enableJsonResponse: true,
    // Origin is validated by the Worker fetch handler below.
    enableDnsRebindingProtection: false
  });
  res.on("close", () => {
    Promise.allSettled([transport.close(), server.close()]);
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch {
    if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", id: req.body?.id ?? null, error: { code: -32603, message: "MCP handler failed. Inspect the Worker logs." } });
  }
});
app.all("/mcp", (_req, res) => {
  res.set("Allow", "POST, OPTIONS").status(405).json({ note: "This stateless MCP endpoint accepts POST JSON messages." });
});
app.use((error, _req, res, _next) => {
  res.status(error.status ?? 500).json({ error: "Invalid request or server error." });
});
var nodeHandler = httpServerHandler(app.listen(3e3));
var cloudflare_adapter_default = {
  async fetch(request2, env, ctx) {
    const url = new URL(request2.url);
    const origin = request2.headers.get("Origin");
    if (origin && ![url.origin, "https://gemini.google.com"].includes(origin)) {
      return new Response("Origin not allowed.", { status: 403 });
    }
    let response;
    if (request2.method === "OPTIONS") response = new Response(null, { status: 204 });
    else response = await nodeHandler.fetch(request2, env, ctx);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Vary", "Origin");
    if (origin) headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Accept, MCP-Protocol-Version");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
};
export {
  cloudflare_adapter_default as default
};
