import dotenv from 'dotenv'
dotenv.config()

import nodemailer from 'nodemailer'
import { google } from 'googleapis'

const OAUTH_REDIRECT_URI = 'https://developers.google.com/oauthplayground'

function getOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Missing Google OAuth environment variables.')
  }
  const oAuth2Client = new google.auth.OAuth2(clientId, clientSecret, OAUTH_REDIRECT_URI)
  oAuth2Client.setCredentials({ refresh_token: refreshToken })
  return oAuth2Client
}

async function main() {
  console.log('Priming Access Token from Google OAuth...')
  try {
    const oAuth2Client = getOAuth2Client()
    const { token } = await oAuth2Client.getAccessToken()
    console.log('Access token retrieved successfully:', token ? `${token.substring(0, 10)}...` : 'null')
    
    console.log('Testing SMTP connection with Nodemailer...')
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        type: 'OAuth2',
        user: process.env.EMAIL_USER,
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
        accessToken: token || undefined,
      },
    })
    
    await transporter.verify()
    console.log('Transporter SMTP verification succeeded!')

    console.log('Sending test email...')
    const info = await transporter.sendMail({
      from: `AM Kia <${process.env.EMAIL_USER}>`,
      to: 'sk9969401@gmail.com',
      subject: 'Antigravity Direct SMTP Test',
      text: 'If you see this, Nodemailer is working perfectly.',
    })
    console.log('Email sent successfully! MessageID:', info.messageId)
  } catch (err) {
    console.error('SMTP/OAuth2 Error:', err)
  }
}

main()
