import { importX509, jwtVerify } from "npm:jose@6";
import { resolveHistoricalClose } from "../_shared/stockHistory.ts";

const projectId = Deno.env.get("FIREBASE_PROJECT_ID");
const alphaVantageApiKey = Deno.env.get("ALPHA_VANTAGE_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-firebase-id-token",
};

let cachedCerts: Record<string, string> | null = null;
let certsExpireAt = 0;

async function getFirebaseCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < certsExpireAt) return cachedCerts;
  const response = await fetch(
    "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
  );
  if (!response.ok) throw new Error("Unable to retrieve Firebase certificates.");
  const certs = await response.json() as Record<string, string>;
  const maxAge = Number((response.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || "300");
  cachedCerts = certs;
  certsExpireAt = Date.now() + maxAge * 1000;
  return certs;
}

async function verifyFirebaseToken(token: string): Promise<string> {
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not configured on the Edge Function.");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed Firebase ID token.");
  const header = JSON.parse(atob(parts[0].replace(/-/g, "+").replace(/_/g, "/")));
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    throw new Error("Unsupported token signing algorithm.");
  }
  let certs = await getFirebaseCerts();
  if (!certs[header.kid]) {
    cachedCerts = null;
    certsExpireAt = 0;
    certs = await getFirebaseCerts();
  }
  if (!certs[header.kid]) throw new Error("Firebase signing certificate not found.");
  const publicKey = await importX509(certs[header.kid], "RS256");
  const { payload } = await jwtVerify(token, publicKey, {
    algorithms: ["RS256"],
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    requiredClaims: ["exp", "iat", "sub", "auth_time"],
  });
  if (typeof payload.sub !== "string" || !payload.sub) throw new Error("Invalid Firebase user ID.");
  return payload.sub;
}

async function callAlphaVantage(params: Record<string, string>): Promise<Record<string, any>> {
  if (!alphaVantageApiKey) throw new Error("ALPHA_VANTAGE_API_KEY is not configured on the Edge Function.");
  const url = new URL("https://www.alphavantage.co/query");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("apikey", alphaVantageApiKey);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Alpha Vantage returned HTTP ${response.status}.`);
  const payload = await response.json() as Record<string, any>;
  if (payload.Note || payload.Information) {
    throw new Error("Alpha Vantage rate limit or API entitlement reached. Try again later.");
  }
  if (payload["Error Message"]) throw new Error(String(payload["Error Message"]));
  return payload;
}

function validateSymbol(value: unknown): string {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{0,31}$/.test(symbol)) {
    throw new Error("Select a valid exchange ticker from the stock search results.");
  }
  return symbol;
}


Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed." }, { status: 405, headers: corsHeaders });
  }

  try {
    const idToken = request.headers.get("x-firebase-id-token") || "";
    await verifyFirebaseToken(idToken);
    const body = await request.json() as {
      action?: string;
      symbol?: string;
      query?: string;
      date?: string;
    };
    const action = String(body.action || "quote");

    if (action === "search") {
      const query = String(body.query || "").trim();
      if (query.length < 2 || query.length > 80) {
        return Response.json({ error: "Enter at least two characters to search stocks." }, { status: 400, headers: corsHeaders });
      }
      const payload = await callAlphaVantage({ function: "SYMBOL_SEARCH", keywords: query });
      const matches = Array.isArray(payload.bestMatches) ? payload.bestMatches : [];
      const results = matches
        .map((item: Record<string, unknown>) => {
          const symbol = String(item["1. symbol"] || "").trim().toUpperCase();
          const name = String(item["2. name"] || "").trim();
          const region = String(item["4. region"] || "").trim();
          const type = String(item["3. type"] || "Equity").trim();
          const currency = String(item["8. currency"] || "").trim();
          const matchScore = Number(item["9. matchScore"] || 0);
          const suffix = symbol.split(".").pop() || "";
          const exchange = suffix === "BSE" || suffix === "NSE" ? suffix : region;
          return { symbol, name, region, type, currency, exchange, matchScore };
        })
        .filter((item: { symbol: string; name: string; type: string }) =>
          item.symbol && item.name && /equity|etf|common stock/i.test(item.type),
        )
        .sort((a: { region: string; matchScore: number }, b: { region: string; matchScore: number }) => {
          const indiaRank = Number(/india/i.test(b.region)) - Number(/india/i.test(a.region));
          return indiaRank || b.matchScore - a.matchScore;
        })
        .slice(0, 10);
      return Response.json({ results }, { headers: corsHeaders });
    }

    if (action === "historical") {
      const symbol = validateSymbol(body.symbol);
      const requestedDate = String(body.date || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || Number.isNaN(Date.parse(`${requestedDate}T00:00:00Z`))) {
        return Response.json({ error: "Enter a valid investment date in YYYY-MM-DD format." }, { status: 400, headers: corsHeaders });
      }
      // Compact history (latest 100 trading sessions) works with standard
      // Alpha Vantage keys. Set the optional secret to "full" only when the
      // account has the premium entitlement for the full 25+ year response.
      const outputsize = Deno.env.get("ALPHA_VANTAGE_HISTORICAL_OUTPUTSIZE") === "full" ? "full" : "compact";
      const payload = await callAlphaVantage({
        function: "TIME_SERIES_DAILY",
        symbol,
        outputsize,
      });
      const series = payload["Time Series (Daily)"] as Record<string, Record<string, string>> | undefined;
      if (!series) throw new Error("No historical daily prices were returned for this stock.");
      // For a past market holiday, use the next trading session. If the
      // next session has not happened yet, use the latest previous close.
      const resolved = resolveHistoricalClose(series, requestedDate);
      return Response.json({
        symbol,
        price: resolved.price,
        date: resolved.date,
        requestedDate,
        matchType: resolved.matchType,
        label: `Alpha Vantage historical close · ${resolved.date}`,
        priceType: "daily_close",
      }, { headers: corsHeaders });
    }

    if (action === "quote") {
      const symbol = validateSymbol(body.symbol);
      const quotePayload = await callAlphaVantage({ function: "GLOBAL_QUOTE", symbol });
      const quote = quotePayload["Global Quote"] as Record<string, unknown> | undefined;
      const price = Number(quote?.["05. price"]);
      const date = String(quote?.["07. latest trading day"] || "");
      if (!Number.isFinite(price) || price <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("No valid quote was returned for this ticker.");
      }
      return Response.json({ price, date, label: `Alpha Vantage quote · ${date}` }, { headers: corsHeaders });
    }

    return Response.json({ error: "Unsupported stock-data action." }, { status: 400, headers: corsHeaders });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to retrieve stock market data.";
    const status = message.includes("Firebase") || message.includes("token") || message.includes("Malformed") ? 401 : 502;
    return Response.json({ error: message }, { status, headers: corsHeaders });
  }
});
