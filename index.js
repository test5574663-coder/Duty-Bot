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
const CHANNEL_ID = "YOUR_CHANNEL_ID";
const ADMIN_ROLE_ID = "YOUR_ADMIN_ROLE_ID";
const THUC_TAP_ROLE_ID = "YOUR_TT_ROLE_ID"; // optional hiển thị thêm

// ===== FIREBASE =====
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: serviceAccount.databaseURL
});

const db = admin.database();

//========== Keep Alive ================
import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Bot is alive!");
});

app.listen(PORT, () => {
  console.log(`🌐 Web server chạy tại port ${PORT}`);
});

// ===== DISCORD =====
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
function getToday() {
  return new Date().toISOString().split('T')[0];
}

function now() {
  return new Date().toLocaleTimeString('vi-VN');
}

// ===== EMBED =====
async function updateEmbed(userId, data) {
  const channel = await client.channels.fetch(CHANNEL_ID);

  const embed = new EmbedBuilder()
    .setTitle("BẢNG ONDUTY")
    .setColor("#8B0000")
    .setDescription(`
**Tên Nhân Sự:** <@${userId}>
**Biển Số:** ${data.bienso || "Chưa có"}

**Thời Gian Onduty:**
${data.start || "--"} → ${data.end || "--"}

**Ngày:** ${data.date}

**Tổng Thời Gian:** ${Math.floor(data.total / 60)} giờ ${data.total % 60} phút
**Trạng Thái:** ${data.active ? "Đang ON" : "OFF"}
`);

  // update message cũ
  if (data.messageId) {
    try {
      const msg = await channel.messages.fetch(data.messageId);
      await msg.edit({
        content: `<@${userId}>`,
        embeds: [embed]
      });
      return;
    } catch {}
  }

  // tạo mới
  const msg = await channel.send({
    content: `<@${userId}>`,
    embeds: [embed]
  });

  await db.ref(`onduty/${userId}/${data.date}`).update({
    messageId: msg.id
  });
}

// ===== START =====
async function startDuty(user) {
  const date = getToday();
  const ref = db.ref(`onduty/${user.id}/${date}`);

  let data = (await ref.get()).val() || {};

  if (data.active) return;

  data.active = true;
  data.start = now();
  data.lastStart = Date.now();
  data.total = data.total || 0;
  data.date = date;

  await ref.set(data);
  await updateEmbed(user.id, data);
}

// ===== END =====
async function endDuty(user) {
  const date = getToday();
  const ref = db.ref(`onduty/${user.id}/${date}`);
  let data = (await ref.get()).val();

  if (!data || !data.active) return;

  const minutes = Math.floor((Date.now() - data.lastStart) / 60000);

  data.total += minutes;
  data.active = false;
  data.end = now();

  await ref.set(data);
  await updateEmbed(user.id, data);
}

// ===== PRESENCE AUTO OFF =====
client.on('presenceUpdate', async (oldP, newP) => {
  if (!oldP || !oldP.member) return;

  const oldA = oldP.activities || [];
  const newA = newP.activities || [];

  const wasPlaying = oldA.some(a =>
    a.name.toLowerCase().includes("gta5vn")
  );

  const isPlaying = newA.some(a =>
    a.name.toLowerCase().includes("gta5vn")
  );

  if (wasPlaying && !isPlaying) {
    console.log(`⚠️ Auto OFF: ${oldP.member.user.tag}`);
    await endDuty(oldP.member.user);
  }
});

// ===== AUTO RESET 00:00 =====
setInterval(async () => {
  const nowTime = new Date();

  if (nowTime.getHours() === 0 && nowTime.getMinutes() === 0) {
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

  // ===== ON DUTY (CHECK GAME) =====
  if (i.commandName === 'onduty') {
    const activities = member.presence?.activities || [];

    const isPlaying = activities.some(a =>
      a.name.toLowerCase().includes("gta5vn")
    );

    if (!isPlaying) {
      return i.reply({
        content: "❌ Bạn phải vào GTA5VN mới được onduty!",
        ephemeral: true
      });
    }

    await startDuty(member.user);

    return i.reply({
      content: "✅ Đã ON DUTY",
      ephemeral: true
    });
  }

  // ===== OFF =====
  if (i.commandName === 'offduty') {
    await endDuty(member.user);

    return i.reply({
      content: "🛑 Đã OFF DUTY",
      ephemeral: true
    });
  }

  // ===== BIỂN SỐ =====
  if (i.commandName === 'thaybienso') {
    const bienso = i.options.getString('bienso');
    const date = getToday();

    await db.ref(`onduty/${member.user.id}/${date}/bienso`).set(bienso);

    const data = (await db.ref(`onduty/${member.user.id}/${date}`).get()).val();

    await updateEmbed(member.user.id, data);

    return i.reply({
      content: "🚗 Đã cập nhật biển số",
      ephemeral: true
    });
  }

  // ===== ADMIN =====
  if (!member.roles.cache.has(ADMIN_ROLE_ID)) {
    return i.reply({ content: "❌ Không có quyền!", ephemeral: true });
  }

  const target = i.options.getUser('user');
  const minutes = i.options.getInteger('minutes') || 0;
  const date = getToday();

  const ref = db.ref(`onduty/${target.id}/${date}`);
  let data = (await ref.get()).val() || { total: 0, date };

  if (i.commandName === 'penalty') {
    data.total += minutes;
  }

  if (i.commandName === 'adjust') {
    data.total -= minutes;
  }

  if (i.commandName === 'forceoff') {
    await endDuty(target);
    return i.reply({ content: "⚠️ Đã force off", ephemeral: true });
  }

  await ref.set(data);
  await updateEmbed(target.id, data);

  i.reply({ content: "✅ Done", ephemeral: true });
});

// ===== LOGIN =====
client.login(process.env.DISCORD_TOKEN);