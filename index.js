require("dotenv").config();
const http = require("http");
const https = require("https");
const admin = require("firebase-admin");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");

// ===== FIREBASE =====
const serviceAccount = JSON.parse(process.env.FIREBASE_KEY);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL
});

const firebase = admin.database();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const ALLOWED_CHANNEL_ID = "1482561032378650769";

// ===== KEEP ALIVE =====
http.createServer((req, res) => res.end("OK")).listen(3000);

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== CACHE =====
const cache = new Map();

async function getUser(id) {
  if (cache.has(id)) return cache.get(id);

  const snap = await firebase.ref(`users/${id}`).once("value");
  let data = snap.val();

  if (!data) data = { total: 0, days: {} };
  if (!data.days) data.days = {};

  cache.set(id, data);
  return data;
}

async function saveUser(id, data) {
  cache.set(id, data);
  await firebase.ref(`users/${id}`).set(data);
}

// ===== TIME =====
function nowVN() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}
function dateKeyVN() {
  return nowVN().toLocaleDateString("vi-VN");
}
function formatTime(ms) {
  return new Date(ms).toLocaleTimeString("vi-VN", { hour12: false });
}
function diffText(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// ===== CHECK GTA =====
function isPlayingGTA(member) {
  try {
    if (!member.presence) return false;

    return (member.presence.activities || []).some(a =>
      a?.name?.toLowerCase().trim() === "gta5vn"
    );
  } catch {
    return false;
  }
}

// ===== EMBED =====
function buildEmbed(member, user, dayKey, status) {
  const day = user.days[dayKey];
  if (!day) return null;

  let timeline = "";
  let total = 0;
  const now = Date.now();

  for (const s of day.sessions) {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "..."}\n`;
    total += end - s.start;
  }

  if (day.extra) total += day.extra;

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  return new EmbedBuilder()
    .setColor(status.includes("Off") ? "#ff4d4f" : "#00ff9c")
    .setDescription(
`👤 ${member}
🚗 ${day.plate || "Chưa nhập"}

⏱️ ${timeline || "Chưa có"}
📅 ${dayKey}

🕒 ${diffText(total)}
${isIntern ? `📊 Tổng: ${diffText(user.total)}` : ""}

📌 ${status}`
    );
}

// ===== SEND =====
async function sendOrUpdateEmbed(channel, member, user, dayKey, status) {
  if (channel.id !== ALLOWED_CHANNEL_ID) return;

  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);
  if (!embed) return;

  if (day.messageId) {
    try {
      const msg = await channel.messages.fetch(day.messageId);
      await msg.edit({ content: `<@${member.id}>`, embeds: [embed] });
      return;
    } catch {}
  }

  const msg = await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed]
  });

  day.messageId = msg.id;
  await saveUser(member.id, user);
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o => o.setName("bienso").setDescription("Biển số").setRequired(true)),

  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc trực")
].map(c => c.toJSON());

// ===== READY =====
client.once("clientReady", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Bot ready");
});

// ===== COMMAND =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  try {
    if (i.channel.id !== ALLOWED_CHANNEL_ID)
      return i.reply({ content: "Sai kênh", ephemeral: true });

    const member = await i.guild.members.fetch(i.user.id);
    const user = await getUser(member.id);
    const dayKey = dateKeyVN();

    if (i.commandName === "onduty") {
      if (!isPlayingGTA(member))
        return i.reply({ content: "❌ Phải vào GTA5VN", ephemeral: true });

      let day = user.days[dayKey];
      if (!day) {
        day = user.days[dayKey] = { plate: "", sessions: [], extra: 0 };
      }

      if (day.sessions.some(s => !s.end))
        return i.reply({ content: "Đang trực", ephemeral: true });

      day.plate = i.options.getString("bienso");
      day.sessions.push({ start: Date.now(), end: null });

      await saveUser(member.id, user);
      await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Đang trực");

      return i.reply({ content: "OK", ephemeral: true });
    }

    if (i.commandName === "offduty") {
      const day = user.days[dayKey];
      if (!day) return i.reply({ content: "Chưa trực", ephemeral: true });

      const last = day.sessions.find(s => !s.end);
      if (!last) return i.reply({ content: "Đã off", ephemeral: true });

      last.end = Date.now();
      user.total += last.end - last.start;

      await saveUser(member.id, user);
      await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Off");

      return i.reply({ content: "OK", ephemeral: true });
    }

  } catch (err) {
    console.error("ERROR:", err);
    if (!i.replied) i.reply({ content: "❌ Bot lỗi", ephemeral: true });
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (oldP, newP) => {
  try {
    if (!newP?.member) return;

    const member = newP.member;
    const user = await getUser(member.id);
    const dayKey = dateKeyVN();

    if (!user.days) return;
    const day = user.days[dayKey];
    if (!day) return;

    if (!isPlayingGTA(member)) {
      const last = day.sessions.find(s => !s.end);
      if (!last) return;

      last.end = Date.now();
      user.total += last.end - last.start;

      await saveUser(member.id, user);

      const ch = await client.channels.fetch(ALLOWED_CHANNEL_ID);
      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off GTA");
    }

  } catch (err) {
    console.error("AUTO GTA ERROR:", err);
  }
});

// ===== AUTO OFF 23:59 =====
setInterval(async () => {
  try {
    const now = nowVN();
    if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

    const dayKey = dateKeyVN();

    const snap = await firebase.ref("users").once("value");
    const all = snap.val() || {};

    for (const id in all) {
      const user = all[id];
      if (!user?.days) continue;

      const day = user.days[dayKey];
      if (!day) continue;

      const last = day.sessions?.find(s => !s.end);
      if (!last) continue;

      last.end = Date.now();
      user.total += last.end - last.start;

      await saveUser(id, user);

      try {
        const member = await client.guilds.cache.get(GUILD_ID)?.members.fetch(id);
        const ch = await client.channels.fetch(ALLOWED_CHANNEL_ID);
        await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Qua ngày)");
      } catch {}
    }

  } catch (err) {
    console.error("AUTO 23:59 ERROR:", err);
  }
}, 60000);

client.login(TOKEN);
