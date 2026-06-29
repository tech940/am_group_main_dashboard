import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { BASE_PATH } from './utils'

export function transformHtml(content: string): string {
  content = content.replace(/fetch\(\s*['"`]\/api\//g, `fetch('/api/kia-insurance/`)
  content = content.replace(/(<a\s[^>]*?href\s*=\s*)["']\//g, `$1"${BASE_PATH}/`)
  content = content.replace(/location\.href\s*=\s*['"]#?['"]/g, `location.href='${BASE_PATH}'`)
  content = content.replace(/location\.href\s*=\s*['"](?!\/\/|\/api|http|\/kia-insurance)[^'"]*['"]/g, (m) => {
    if (m.includes(BASE_PATH)) return m
    return m.replace(/['"][^'"]*['"]$/, `'${BASE_PATH}'`)
  })
  content = injectNav(content)
  return content
}

function injectNav(content: string): string {
  const navStyle = 'display:flex;align-items:center;gap:4px;padding:4px 12px;background:#f0f4ff;border-bottom:1px solid #d0dce8;flex-shrink:0;flex-wrap:wrap'
  const tabStyle = 'padding:4px 12px;border:1px solid #d0dce8;border-radius:6px;font-size:11px;text-decoration:none;background:#fff;color:#333;transition:.1s'
  const activeStyle = 'padding:4px 12px;border:1px solid #002db3;border-radius:6px;font-size:11px;text-decoration:none;background:#002db3;color:#fff;font-weight:600'
  const pageLinks = [
    { path: '/dashboard', label: 'Data Analysis', dataPage: 'dashboard' },
    { path: '/performance', label: 'Performance Table', dataPage: 'performance' },
    { path: '/call-center', label: 'Call Center', dataPage: 'call-center' },
  ]
  let navHtml = '<div id="insNav" style="' + navStyle + '">'
  for (const link of pageLinks) {
    navHtml += '<a href="' + BASE_PATH + link.path + '" style="' + tabStyle + '" data-page="' + link.dataPage + '">' + link.label + '</a>'
  }
  navHtml += '</div>'
  navHtml += '<script>(function(){var p=window.location.pathname.replace(/\\/+$/,"");var links=document.getElementById("insNav").querySelectorAll("a");for(var i=0;i<links.length;i++){if(p.endsWith(links[i].getAttribute("data-page"))){links[i].style.cssText="' + activeStyle + '"}}})()<' + '/script>'
  return content.replace('<body>', '<body>' + navHtml)
}

export function serveHtml(relativePath: string): NextResponse {
  const filePath = path.join(process.cwd(), relativePath)
  const content = fs.readFileSync(filePath, 'utf8')
  const transformed = transformHtml(content)
  return new NextResponse(transformed, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

export function serveLandingHtml(): NextResponse {
  const filePath = path.join(process.cwd(), 'kia-insurance-dashboard', 'landing.html')
  let content = fs.readFileSync(filePath, 'utf8')
  content = content.replace(/fetch\(\s*API\s*\+\s*['"`]\/api\//g, `fetch('/api/kia-insurance/`)
  content = content.replace(/const API = ''/g, 'const API = ""')
  content = content.replace(/(<a\s[^>]*?href\s*=\s*)["']\//g, `$1"${BASE_PATH}/`)
  content = content.replace(/if\(!t\)\s*\{[^}]*location\.href\s*=\s*['"]#?['"][^}]*\}/g, '')
  return new NextResponse(content, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}
