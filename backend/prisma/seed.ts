import { PrismaClient, EmailStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Upsert development user
  const user = await prisma.user.upsert({
    where: { email: 'dev-user@example.com' },
    update: {},
    create: {
      name: 'Development User',
      email: 'dev-user@example.com',
      googleId: 'dev-google-id',
      avatarUrl: 'https://api.dicebear.com/7.x/bottts/svg?seed=dev-user',
    },
  });
  console.log(`👤 Seeded/Verified User: ${user.email} (${user.id})`);

  // 2. Seed development sender if not exists
  let sender = await prisma.sender.findFirst({
    where: { email: 'dev-sender@example.com' },
  });

  if (!sender) {
    sender = await prisma.sender.create({
      data: {
        name: 'Default Development Sender',
        email: 'dev-sender@example.com',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: 587,
        smtpUser: 'dev-smtp-user',
        smtpPassword: 'dev-smtp-password',
      },
    });
    console.log(`📧 Created Sender: ${sender.email} (${sender.id})`);
  } else {
    console.log(`📧 Verified Sender exists: ${sender.email} (${sender.id})`);
  }

  // 3. Seed sample campaign if not exists
  let campaign = await prisma.campaign.findFirst({
    where: { subject: 'Welcome to ReachInbox!' },
  });

  if (!campaign) {
    campaign = await prisma.campaign.create({
      data: {
        userId: user.id,
        subject: 'Welcome to ReachInbox!',
        body: 'Hello and welcome. This is a seed campaign to test the scheduling layer.',
        startTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day in the future
        delaySeconds: 10,
        hourlyLimit: 100,
      },
    });
    console.log(`📢 Created Campaign: "${campaign.subject}" (${campaign.id})`);

    // Create a few sample emails in the campaign
    const emailsCount = await prisma.email.count({
      where: { campaignId: campaign.id },
    });

    if (emailsCount === 0) {
      const emails = await prisma.email.createMany({
        data: [
          {
            campaignId: campaign.id,
            senderId: sender.id,
            recipient: 'john.doe@example.com',
            subject: campaign.subject,
            body: campaign.body,
            scheduledAt: new Date(campaign.startTime.getTime()),
            status: EmailStatus.SCHEDULED,
          },
          {
            campaignId: campaign.id,
            senderId: sender.id,
            recipient: 'jane.smith@example.com',
            subject: campaign.subject,
            body: campaign.body,
            scheduledAt: new Date(campaign.startTime.getTime() + 10 * 1000),
            status: EmailStatus.SCHEDULED,
          },
          {
            campaignId: campaign.id,
            senderId: sender.id,
            recipient: 'alex.jones@example.com',
            subject: campaign.subject,
            body: campaign.body,
            scheduledAt: new Date(campaign.startTime.getTime() + 20 * 1000),
            status: EmailStatus.SCHEDULED,
          },
        ],
      });
      console.log(`✉️ Created ${emails.count} scheduled emails.`);
    }
  } else {
    console.log(`📢 Campaign already exists: "${campaign.subject}" (${campaign.id})`);
  }

  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
