# Redis Caching Setup Guide

This guide explains how to set up Redis caching for the KIA Dashboard to improve API response times.

## Overview

Redis caching has been implemented for:
- **Business Excellence API** - Caches sheet metadata and full data
- **Cache TTL (Time To Live)**:
  - Metadata: 30 minutes
  - Full data (analytics): 2 hours
  - Paginated data: 30 minutes

## Prerequisites

You need an Upstash Redis account (free tier available).

## Setup Steps

### 1. Create Upstash Redis Database

1. Go to [Upstash Console](https://console.upstash.com/)
2. Sign up or log in
3. Click **Create Database**
4. Choose:
   - **Name**: kia-dashboard-cache (or any name)
   - **Type**: Regional
   - **Region**: Choose closest to your deployment
   - **TLS**: Enabled (recommended)
5. Click **Create**

### 2. Get Redis Credentials

After creating the database:
1. Go to your database details page
2. Scroll to **REST API** section
3. Copy the following:
   - **UPSTASH_REDIS_REST_URL**
   - **UPSTASH_REDIS_REST_TOKEN**

### 3. Configure Environment Variables

Add these to your `.env.local` file:

```env
# Redis Configuration (Upstash)
UPSTASH_REDIS_REST_URL=https://your-redis-url.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-redis-token-here
```

### 4. Restart Your Development Server

```bash
npm run dev
```

## How It Works

### Automatic Caching

When you make API requests, the system automatically:
1. Checks if data exists in Redis cache
2. If **cache HIT**: Returns cached data instantly (fast!)
3. If **cache MISS**: Fetches from database, caches it, then returns

### Cache Invalidation

Cache is automatically invalidated when:
- New data is uploaded via POST endpoint
- Cache TTL expires naturally

### Manual Cache Bypass

To bypass cache and force fresh data, add `skipCache=true` to your API request:

```typescript
// Example: Force fresh data
const response = await fetch('/api/brands/kia/business-excellence?sheetId=123&fetchAll=true&skipCache=true')
```

## Cache Keys Structure

```
kia:business-excellence:metadata:{brand}
kia:business-excellence:sheet:{sheetId}:all
kia:business-excellence:sheet:{sheetId}:page:{page}:limit:{limit}
```

## Monitoring Cache Performance

Check your browser console or server logs for cache status:
- ✅ `Cache HIT` - Data served from cache (fast)
- ❌ `Cache MISS` - Data fetched from database (slower)
- 💾 `Cached data` - Data stored in cache
- 🗑️ `Cache invalidated` - Cache cleared

## Benefits

### Before Redis (Database Only)
- Large dataset queries: 2-5 seconds
- Repeated requests: Same slow response every time
- High database load

### After Redis (With Caching)
- First request: 2-5 seconds (cache miss)
- Subsequent requests: 50-200ms (cache hit) ⚡
- 10-100x faster response times!
- Reduced database load

## Troubleshooting

### Cache Not Working

If you see `⚠️ Redis credentials not found. Caching disabled.`:
1. Check `.env.local` has correct variables
2. Restart your dev server
3. Verify Upstash credentials are correct

### Cache Serving Stale Data

If data seems outdated:
1. Upload new data (automatically invalidates cache)
2. Use `skipCache=true` parameter
3. Wait for TTL to expire (30 min - 2 hours)

### Redis Connection Errors

If you see Redis errors:
1. Check Upstash dashboard - is database active?
2. Verify credentials are correct
3. Check network connectivity
4. System will fallback to database-only mode

## Cost

**Upstash Free Tier:**
- 10,000 commands/day
- 256 MB storage
- Perfect for development and small production apps

**Paid Plans:**
- Pay-as-you-go pricing
- Scales with your usage

## Advanced Configuration

### Adjust Cache TTL

Edit `lib/redis/client.ts`:

```typescript
export const CACHE_TTL = {
  SHORT: 5 * 60,        // 5 minutes
  MEDIUM: 30 * 60,      // 30 minutes (default)
  LONG: 2 * 60 * 60,    // 2 hours
  DAY: 24 * 60 * 60,    // 24 hours
} as const
```

### Add More Cache Keys

Edit `lib/redis/client.ts`:

```typescript
export const CACHE_KEYS = {
  BUSINESS_EXCELLENCE: 'kia:business-excellence',
  RO_BILLING: 'kia:ro-billing',
  // Add more keys here
} as const
```

## Production Deployment

When deploying to production (Vercel, etc.):

1. Add environment variables in your hosting platform:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

2. Consider upgrading Upstash plan based on traffic

3. Monitor cache hit rates in Upstash dashboard

## Support

For issues or questions:
- Check Upstash documentation: https://docs.upstash.com/redis
- Review implementation in `lib/redis/` directory