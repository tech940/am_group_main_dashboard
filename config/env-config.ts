/**
 * Environment Variables Configuration
 * 
 * Copy this file to .env.local and fill in your actual values:
 * 
 * NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
 * NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
 * SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
 * DATABASE_URL=postgresql://user:password@host:port/database
 * NEXT_PUBLIC_APP_URL=http://localhost:3000
 * NEXT_PUBLIC_APP_NAME=Internal Operations Platform
 */

export const env = {
  supabase: {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  database: {
    url: process.env.DATABASE_URL || '',
  },
  app: {
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    name: process.env.NEXT_PUBLIC_APP_NAME || 'Internal Operations Platform',
  },
} as const;

export function validateEnv() {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'DATABASE_URL',
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
