const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Headers de sécurité. CSP adaptée au front (Google Fonts) + Stripe.
const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://js.stripe.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      connectSrc: ["'self'", 'https://api.stripe.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false, // évite de casser le chargement d'images/pdf externes
});

// Fabrique de limiteur : message JSON homogène, en-têtes standard.
function makeLimiter({ windowMs, max, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: message || 'Trop de requêtes, réessayez plus tard.' },
    // On limite par IP ; derrière le proxy Render, req.ip est correct si trust proxy est activé.
  });
}

// Limite globale douce sur toute l'API (anti-abus général).
const apiLimiter = makeLimiter({ windowMs: 60 * 1000, max: 300,
  message: 'Trop de requêtes. Patientez une minute.' });

// Connexion : strict (anti brute-force mot de passe).
const loginLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 10,
  message: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.' });

// Demande d'accès portail (envoi d'e-mail) : très strict (anti-spam / coût Brevo).
const magicLinkLimiter = makeLimiter({ windowMs: 15 * 60 * 1000, max: 5,
  message: 'Trop de demandes de lien. Réessayez dans quelques minutes.' });

module.exports = { securityHeaders, apiLimiter, loginLimiter, magicLinkLimiter };
