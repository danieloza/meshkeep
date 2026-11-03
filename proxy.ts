import { NextResponse, type NextRequest } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  // Push-to-talk runs Whisper in the browser: 'wasm-unsafe-eval' lets the page
  // compile ONNX Runtime's WebAssembly, and the two Hugging Face hosts are where
  // the model weights are downloaded from (huggingface.co redirects to its CDN
  // under hf.co). Recordings never leave the browser.
  const contentSecurityPolicy = process.env.NODE_ENV === 'production'
    ? `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'; worker-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self' https://huggingface.co https://*.hf.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`
    : null;
  if (contentSecurityPolicy) requestHeaders.set('Content-Security-Policy', contentSecurityPolicy);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  // The microphone is allowed for this origin only, for push-to-talk.
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  if (contentSecurityPolicy) {
    response.headers.set('Content-Security-Policy', contentSecurityPolicy);
    if (request.nextUrl.protocol === 'https:') response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = { matcher: '/:path*' };
