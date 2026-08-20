import { EmailService } from './src/services/email.service';

async function main() {
  const result = await EmailService.getSentEmails('aac8d595-3ba1-49c1-97fc-542f50dfed3d');
  console.log('--- API query output for getSentEmails ---');
  console.log(JSON.stringify(result, null, 2));
}

main().catch(console.error);