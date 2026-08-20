import { Router } from 'express';
import passport from 'passport';
import { env } from '../config/env';

const router = Router();

// Redirect to Google Login
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email'],
  })
);

// Google OAuth callback
router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: `${env.FRONTEND_URL}/login?error=auth_failed`,
  }),
  (req, res) => {
    // Successful login, redirect to frontend dashboard
    res.redirect(`${env.FRONTEND_URL}/`);
  }
);

// Logout route
router.post('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) {
      return next(err);
    }
    req.session.destroy((destroyErr) => {
      if (destroyErr) {
        return next(destroyErr);
      }
      res.clearCookie('connect.sid', {
        path: '/',
        httpOnly: true,
      });
      res.status(200).json({ success: true, message: 'Logged out successfully' });
    });
  });
});

// Current user profile
router.get('/me', (req, res) => {
  if (!req.isAuthenticated() || !req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }

  res.status(200).json({
    success: true,
    data: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      avatarUrl: req.user.avatarUrl,
    },
  });
});

export default router;
