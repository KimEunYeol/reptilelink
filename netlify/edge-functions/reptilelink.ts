import worker from '../../worker/index';

type Context = { next(request: Request): Promise<Response> };
declare const Netlify: { env: { get(name: string): string | undefined } };

// Reuse the existing command/ownership/media boundaries; only the host bindings differ.
export default function handler(request: Request, context: Context): Promise<Response> {
  return worker.fetch(request, {
    SUPABASE_URL: Netlify.env.get('SUPABASE_URL') ?? '',
    SUPABASE_PUBLISHABLE_KEY: Netlify.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
    SUPABASE_SECRET_KEY: Netlify.env.get('SUPABASE_SECRET_KEY') ?? '',
    APP_ORIGIN: Netlify.env.get('APP_ORIGIN') ?? '',
    ANALYTICS_HMAC_KEY: Netlify.env.get('ANALYTICS_HMAC_KEY'),
    ASSETS: { fetch: assetRequest => context.next(assetRequest) },
  });
}
