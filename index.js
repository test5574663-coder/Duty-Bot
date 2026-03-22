import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder
} from 'discord.js';

import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

// ===== CONFIG =====
const CHANNEL_ID = "1482561032378650769";
const ADMIN_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";

// ===== FIREBASE =====
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: serviceAccount.databaseURL
});

const db = admin.database();

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder().setName('onduty').setDescription('Bắt đầu onduty'),
  new SlashCommandBuilder().setName('offduty').setDescription('Kết thúc onduty'),

  new SlashCommandBuilder()
    .setName('thaybienso')
    .setDescription('Thay biển số')
    .addStringOption(o => o.setName('bienso').setRequired(true)),

  new SlashCommandBuilder()
    .setName('penalty')
    .setDescription('Cộng giờ')
    .addUserOption(o => o.setName('user').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setRequired(true)),

  new SlashCommandBuilder()
    .setName('adjust')
    .setDescription('Trừ giờ')
    .addUserOption(o => o.setName('user').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setRequired(true)),

  new SlashCommandBuilder()
    .setName('forceoff')
    .setDescription('Force off duty')
    .addUserOption(o => o.setName('user').setRequired(true))
];

// ===== REGISTER =====
client.once('ready', async () => {
  console.log(`🔥 Bot ready: ${client.user.tag}`);

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
});

// ===== UTIL =====
function getDate() {
  return new Date().toISOString().split('T')[0];
}

function getTime() {
  return new Date().toLocaleTimeString('vi-VN');
}

// ===== EMBED =====
async function updateEmbed(userId, data) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  const member = await channel.guild.members.fetch(userId);

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  const embed = new EmbedBuilder()
    .setTitle("BẢNG ONDUTY")
    .setColor("#8B0000")
    .setDescription(`
**Nhân sự:** <@${userId}>
**Biển số:** ${data.bienso || "Chưa có"}

**Thời gian:**
${data.start || "--"} → ${data.end || "--"}

**Ngày:** ${data.date}

**${isIntern ? "Tổng giờ thực tập" : "Tổng thời gian"}:** ${Math.floor(data.total / 60)}h ${data.total % 60}p
**Trạng thái:** ${data.active ? "ON" : "OFF"}
`);

  if (data.messageId) {
    try {
      const msg = await channel.messages.fetch(data.messageId);
      await msg.edit({
        content: `🔎 ONDUTY | <@${userId}> | ${data.bienso || "N/A"}`,
        embeds: [embed]
      });
      return;
    } catch {}
  }

  const msg = await channel.send({
    content: `🔎 ONDUTY | <@${userId}> | ${data.bienso || "N/A"}`,
    embeds: [embed]
  });

  await db.ref(`onduty/${userId}/${data.date}`).update({
    messageId: msg.id
  });
}

// ===== START =====
async function startDuty(user) {
  const date = getDate();
  const ref = db.ref(`onduty/${user.id}/${date}`);

  let data = (await ref.get()).val() || {};

  if (data.active) return;

  data.active = true;
  data.start = getTime();
  data.lastStart = Date.now();
  data.total = data.total || 0;
  data.date = date;

  await ref.set(data);
  await updateEmbed(user.id, data);
}

// ===== END =====
async function endDuty(user) {
  const date = getDate();
  const ref = db.ref(`onduty/${user.id}/${date}`);

  let data = (await ref.get()).val();
  if (!data || !data.active) return;

  const minutes = Math.floor((Date.now() - data.lastStart) / 60000);

  data.total += minutes;
  data.active = false;
  data.end = getTime();

  await ref.set(data);
  await updateEmbed(user.id, data);
}

// ===== AUTO OFF GTA =====
client.on('presenceUpdate', async (oldP, newP) => {
  if (!oldP || !oldP.member) return;

  const wasPlaying = oldP.activities?.some(a => a.name.toLowerCase().includes("gta5vn"));
  const isPlaying = newP.activities?.some(a => a.name.toLowerCase().includes("gta5vn"));

  if (wasPlaying && !isPlaying) {
    await endDuty(oldP.member.user);
  }
});

// ===== AUTO OFF 00:00 =====
setInterval(async () => {
  const now = new Date();

  if (now.getHours() === 0 && now.getMinutes() === 0) {
    console.log("⏰ Reset ngày mới");

    const snap = await db.ref("onduty").get();

    snap.forEach(userSnap => {
      const userId = userSnap.key;

      userSnap.forEach(async daySnap => {
        const data = daySnap.val();

        if (data.active) {
          await endDuty({ id: userId });
        }
      });
    });
  }
}, 60000);

// ===== INTERACTION =====
client.on('interactionCreate', async (i) => {
  if (!i.isChatInputCommand()) return;

  if (i.channelId !== CHANNEL_ID) {
    return i.reply({ content: "❌ Sai kênh!", ephemeral: true });
  }

  const member = i.member;

  if (i.commandName === 'onduty') {
    const isPlaying = member.presence?.activities?.some(a =>
      a.name.toLowerCase().includes("gta5vn")
    );

    if (!isPlaying) {
      return i.reply({ content: "❌ Vào Game Đi ĐM", ephemeral: true });
    }

    await startDuty(member.user);
    return i.reply({ content: "✅ ON DUTY", ephemeral: true });
  }

  if (i.commandName === 'offduty') {
    await endDuty(member.user);
    return i.reply({ content: "🛑 OFF DUTY", ephemeral: true });
  }

  if (i.commandName === 'thaybienso') {
    const bienso = i.options.getString('bienso');
    const date = getDate();

    await db.ref(`onduty/${member.user.id}/${date}/bienso`).set(bienso);

    const data = (await db.ref(`onduty/${member.user.id}/${date}`).get()).val();
    await updateEmbed(member.user.id, data);

    return i.reply({ content: "🚗 Đã cập nhật", ephemeral: true });
  }

  // ===== ADMIN =====
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
    return i.reply({ content: "❌ Mày Đéo Có Quyền", ephemeral: true });
  }

  const target = i.options.getUser('user');
  const minutes = i.options.getInteger('minutes') || 0;
  const date = getDate();

  const ref = db.ref(`onduty/${target.id}/${date}`);
  let data = (await ref.get()).val() || { total: 0, date };

  if (i.commandName === 'penalty') data.total += minutes;
  if (i.commandName === 'adjust') data.total -= minutes;

  if (i.commandName === 'forceoff') {
    await endDuty(target);
    return i.reply({ content: "⚠️ Force OFF", ephemeral: true });
  }

  await ref.set(data);
  await updateEmbed(target.id, data);

  i.reply({ content: "✅ Done", ephemeral: true });
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);
