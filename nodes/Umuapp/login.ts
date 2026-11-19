import { IDataObject, IExecuteFunctions, IHttpRequestMethods, ILoadOptionsFunctions, IPollFunctions, JsonObject, NodeApiError } from "n8n-workflow";

const UMUAPP_CLIENTID = "dW11YXBwOnN6eEstNV9lSmpzLWFVai02NE1wVVotR1BQekdMaFlQTEdsMHdyWWpZTkxvOGViNzdiMWRlMWNjNjBhYTM1M2JhMGRmMDNhOTE3dm1ZM2w1b1ZQTzN3";

export type Ctx = IExecuteFunctions | IPollFunctions | ILoadOptionsFunctions;
export type Host = "api" | "umuapp" | "entrada" | "push" | "asistencia";

interface Token {
    access_token: string;
    expires_in: number;
    token_type: "Bearer" | string;
}

interface Session extends Token {
    expires_at: number;
}

export interface UmuappCreds {
    username: string;
    password: string;
}

interface TokenRes extends Token {
    id_token: string;
    scope: string;
}

const sessions = new Map<string, Session>();

export function keys<T extends object>(o: T) {
    return Object.keys(o) as (keyof T)[];
}

export function urlEncode(data: object): string {
    const parts: string[] = [];
    for (const k of keys(data))
        parts.push(`${encodeURI(k)}=${data[k]}`)
    return encodeURI(parts.join("&"));
}

export async function getToken(ctx: Ctx) {
    const creds = await ctx.getCredentials("umuappApi");
    const tokenRes = await ctx.helpers.httpRequest({
        url: "https://entrada.um.es/cas/oidc/accessToken",
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
            "X-service": "https://umuapp.um.es",
            "Authorization": `Basic ${UMUAPP_CLIENTID}`
        },
        body: urlEncode({
            ...creds,
            grant_type: "password",
            scope: "micampus"
        }),
        ignoreHttpStatusErrors: true,
        returnFullResponse: true,
    }) as {
        body: TokenRes;
        headers: Map<string, string>;
        statusCode: number;
        statusMessage: string;
    };

    if (tokenRes.statusCode != 200) throw new NodeApiError(ctx.getNode(), tokenRes.body as unknown as JsonObject, {
        message: "Error al hacer la petición de los tokens.",
        httpCode: tokenRes.statusMessage,
    });

    return tokenRes;
}

export async function backendLogin(ctx: Ctx, session: Session) {
    await ctx.helpers.httpRequest({
        url: "https://umuapp.um.es/umuapp/rest/v2.0/public/login",
        method: "POST",
        headers: {
            "Cache-Control": "no-cache",
            "Authorization": `${session.access_token}:${session.expires_in}`
        }
    });
}

export async function getSession(ctx: Ctx, force = false) {
    const c = await ctx.getCredentials("umuappApi") as UmuappCreds;
    const cached = sessions.get(c.username);
    const now = Date.now();
    if (!force && cached && cached.expires_at - 5 * 60_000 > now)  return cached;

    const newTokens = await getToken(ctx);
    const session: Session = { ...newTokens.body, expires_at: now + newTokens.body.expires_in * 1000 + 5 * 60_000 };
    await backendLogin(ctx, session);
    sessions.set(c.username, session);
    return session;
}

export async function getEndpoint(ctx: Ctx, opts: {
    method: IHttpRequestMethods;
    host: Host;
    endpoint: string;
    query?: IDataObject,
    body?: IDataObject;
}) {
    const session = await getSession(ctx);
    return await ctx.helpers.httpRequest({
        url: `https://${opts.host}.um.es${opts.endpoint}` + (opts.query === undefined ? "" : "?" + urlEncode(opts.query)),
        method: opts.method,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Cache-Control": "no-cache",
            "X-service": "https://umuapp.um.es",
            "Authorization": `${session?.token_type ?? "Bearer"} ${session?.access_token}`
        },
        body: opts.body,
        returnFullResponse: true,
    });
}