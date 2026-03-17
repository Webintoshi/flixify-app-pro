export const CORS_ALLOWED_METHODS = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS"
];

export const CORS_ALLOWED_HEADERS = [
  "authorization",
  "content-type"
];

export const CORS_MAX_AGE_SECONDS = 86_400;

export const API_CORS_CONFIG = {
  origin: true,
  methods: CORS_ALLOWED_METHODS,
  allowedHeaders: CORS_ALLOWED_HEADERS,
  optionsSuccessStatus: 204,
  maxAge: CORS_MAX_AGE_SECONDS,
  preflightContinue: false
};
