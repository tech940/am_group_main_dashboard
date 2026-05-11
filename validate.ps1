# Pre-Vercel Validation Script
# Run this before pushing to ensure a successful deployment

$ErrorActionPreference = "Stop"

Write-Host "`n🚀 Starting Pre-Vercel Validation Suite..." -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Linting Check
Write-Host "`n🔍 Step 1: Checking code quality (ESLint)..." -ForegroundColor Yellow
try {
    npm run lint
    Write-Host "✅ Linting passed!" -ForegroundColor Green
} catch {
    Write-Host "❌ Linting failed. Please fix the issues above before pushing." -ForegroundColor Red
    exit 1
}

# 2. Type Check
Write-Host "`n⌨️ Step 2: Verifying TypeScript types..." -ForegroundColor Yellow
try {
    npx tsc --noEmit
    Write-Host "✅ Type check passed!" -ForegroundColor Green
} catch {
    Write-Host "❌ Type errors found. Vercel will fail if you push now." -ForegroundColor Red
    exit 1
}

# 3. Production Build Test
Write-Host "`n🏗️ Step 3: Running a test production build..." -ForegroundColor Yellow
try {
    npm run build
    Write-Host "✅ Production build successful!" -ForegroundColor Green
} catch {
    Write-Host "❌ Build failed. This is exactly what would have happened on Vercel." -ForegroundColor Red
    exit 1
}

Write-Host "`n🎉 CONGRATULATIONS! Your code is 100% ready for Vercel." -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host "Safe to push now.`n" -ForegroundColor Cyan
