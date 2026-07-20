import dotenv from 'dotenv'
dotenv.config()

import { sendTaskAssignedEmail } from '../lib/delegation/emails'

async function main() {
  console.log('Sending test task assigned email...')
  try {
    const success = await sendTaskAssignedEmail({
      toEmail: 'sk9969401@gmail.com',
      toName: 'Sahil Katoch',
      assignerName: 'System Test',
      title: 'Test Task from Antigravity',
      description: 'This is a test task to verify email setup.',
      priority: 'high',
    })
    console.log('Send result:', success)
  } catch (err) {
    console.error('Failed to send:', err)
  }
}

main()
