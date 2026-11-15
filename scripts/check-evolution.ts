import { connectionState, evolutionConfig, isWhatsAppNumber, sendText } from '../src/channels/evolution.js';
import { normalizePhone } from '../src/channels/phone.js';

const sendTest = process.argv.includes('--send-test');
const failures: string[] = [];
const warnings: string[] = [];
const pass = (message: string) => console.log('PASS  ' + message);
const fail = (message: string) => { failures.push(message); console.error('FAIL  ' + message); };
const warn = (message: string) => { warnings.push(message); console.warn('NOTE  ' + message); };

async function main() {
  const config = evolutionConfig();
  if (!config) {
    fail('EVOLUTION_API_URL, EVOLUTION_API_KEY and EVOLUTION_INSTANCE must all be set; URL must begin http:// or https://.');
  } else {
    pass('Evolution API URL, API key and instance are configured.');
    try {
      const connection = await connectionState();
      if (connection.state.toLowerCase() === 'open' || connection.state.toLowerCase() === 'connected') {
        pass('Evolution instance connection state is ' + connection.state + '.');
      } else {
        fail('Evolution instance is not connected (state: ' + connection.state + '). Pair the WhatsApp number in Evolution first.');
      }
    } catch (error) {
      fail('Evolution connection-state request failed: ' + (error instanceof Error ? error.message : 'unknown error'));
    }
  }

  const founder = normalizePhone(process.env.TAMBALA_FOUNDER_WHATSAPP ?? '');
  if (!founder) fail('TAMBALA_FOUNDER_WHATSAPP is missing or is not a valid international phone number.');
  else pass('Founder WhatsApp number is configured (masked): ' + founder.slice(0, 5) + '***' + founder.slice(-2) + '.');

  const webhookToken = process.env.EVOLUTION_WEBHOOK_TOKEN ?? '';
  if (webhookToken.length < 16) fail('EVOLUTION_WEBHOOK_TOKEN must contain at least 16 characters.');
  else pass('Webhook authentication token meets the minimum length.');

  const publicBase = (process.env.PUBLIC_BASE_URL ?? '').replace(/\\/+$/, '');
  if (!publicBase) warn('PUBLIC_BASE_URL is unset; configure the Evolution webhook URL manually using your deployed HTTPS base URL.');
  else pass('Webhook URL: ' + publicBase + '/webhooks/evolution?token=<EVOLUTION_WEBHOOK_TOKEN>');

  const schedulerToken = process.env.TAMBALA_SCHEDULER_TOKEN ?? '';
  if (schedulerToken.length < 24) warn('TAMBALA_SCHEDULER_TOKEN is not configured (24+ chars). Required when using an external cron for the outbox.');
  else pass('External scheduler token meets the minimum length.');

  if (sendTest) {
    if (!config || !founder) fail('Cannot send the test message without a connected Evolution configuration and Founder number.');
    else {
      try {
        const registered = await isWhatsAppNumber(founder);
        if (!registered) fail('The configured Founder number was not confirmed as a WhatsApp account by Evolution.');
        else {
          const result = await sendText(founder, 'Tambala Technologies WhatsApp integration check. This is a test message; no customer communication was sent.');
          if (result.id) pass('Test message accepted by Evolution (message ID: ' + result.id + ').');
          else warn('Evolution accepted the test request but did not return a message ID; confirm delivery on the Founder phone.');
        }
      } catch (error) {
        fail('Outbound self-test failed: ' + (error instanceof Error ? error.message : 'unknown error'));
      }
    }
  } else {
    warn('Outbound send was not attempted. Re-run with --send-test to send one explicit test message to TAMBALA_FOUNDER_WHATSAPP only.');
  }

  console.log('');
  console.log('INBOUND CHECK: send a WhatsApp message from a second phone to the connected business number. Confirm it appears in Messages and is forwarded to the Founder. Then reply STOP from that second phone only if it is a test contact, and confirm the do-not-contact block is recorded.');
  console.log('WEBHOOK SETTINGS: Evolution event MESSAGES_UPSERT enabled; webhook base64 disabled; URL above; HTTP POST; server reachable over HTTPS.');
  if (failures.length) {
    console.error('\\nResult: ' + failures.length + ' failed check(s), ' + warnings.length + ' note(s).');
    process.exitCode = 1;
  } else {
    console.log('\\nResult: configuration/provider checks passed with ' + warnings.length + ' note(s). Inbound delivery still requires the live phone test above.');
  }
}

main().catch((error) => {
  console.error('Evolution checklist failed unexpectedly:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
