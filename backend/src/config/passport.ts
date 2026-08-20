import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { prisma } from './database';
import { env } from './env';

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID || 'dummy-client-id',
      clientSecret: env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret',
      callbackURL: env.GOOGLE_CALLBACK_URL || 'http://localhost:5000/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const googleId = profile.id;
        const name = profile.displayName || profile.username || 'Google User';
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        const avatarUrl = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

        if (!email) {
          return done(new Error('Google account must have an email address'));
        }

        // 1. Find user by googleId
        let user = await prisma.user.findUnique({
          where: { googleId },
        });

        if (user) {
          // Update profile fields if needed
          user = await prisma.user.update({
            where: { id: user.id },
            data: { name, avatarUrl },
          });
          return done(null, user);
        }

        // 2. Find user by email (linking account if email matches but no googleId)
        user = await prisma.user.findUnique({
          where: { email },
        });

        if (user) {
          // Link Google account
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId, name, avatarUrl },
          });
          return done(null, user);
        }

        // 3. Create new user
        user = await prisma.user.create({
          data: {
            googleId,
            name,
            email,
            avatarUrl,
          },
        });

        return done(null, user);
      } catch (err) {
        return done(err as Error);
      }
    }
  )
);

passport.serializeUser((user: any, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id },
    });
    done(null, user);
  } catch (err) {
    done(err);
  }
});
