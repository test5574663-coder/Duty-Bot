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

// ===== FIREBASE INIT =====
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
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => res.end("OK")).listen(PORT);

setInterval(() => {
  if (process.env.RENDER_EXTERNAL_URL) {
    https.get(process.env.RENDER_EXTERNAL_URL);
  }
}, 5 * 60 * 1000);

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

  if (!data) {
    data = { total: 0, days: {} };
    await firebase.ref(`users/${id}`).set(data);
  }

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
  return new Date(ms).toLocaleTimeString("vi-VN", {
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh"
  });
}

function diffText(ms) {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
}

// ===== GTA CHECK (FIX) =====
function isPlayingGTA(member) {
  if (!member.presence) return false;

  const activities = member.presence.activities || [];

  return activities.some(a => {
    if (!a || !a.name) return false;
    return a.name.toLowerCase().trim() === "gta5vn";
  });
}

// ===== EMBED =====
function buildEmbed(member, user, dayKey, status) {
  const day = user.days[dayKey];
  if (!day) return null;

  let timeline = "";
  let totalDay = 0;
  const now = Date.now();

  day.sessions.forEach(s => {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "..."}\n`;
    totalDay += end - s.start;
  });

  if (day.extra) totalDay += day.extra;

  const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

  return new EmbedBuilder()
    .setColor(status.includes("Off") ? "#ff4d4f" : "#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${day.plate || "Chưa nhập"}

**Thời Gian Onduty :**
${timeline || "Chưa có"}

**Ngày Onduty :** ${dayKey}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern ? `\n**Tổng Thời Gian Thực Tập :** ${diffText(user.total)}` : ""}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SEND =====
async function sendOrUpdateEmbed(channel, member, user, dayKey, status) {
  if (channel.id !== ALLOWED_CHANNEL_ID) return;

  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);
  if (!embed) return;

  if (day.messageId && day.channelId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);
      if (msg) {
        await msg.edit({
          content: `<@${member.id}>`,
          embeds: [embed]
        });
        return;
      }
    } catch {}
  }

  const msg = await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed]
  });

  day.messageId = msg.id;
  day.channelId = channel.id;

  await saveUser(member.id, user);
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso").setDescription("Biển số xe").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("thaybienso")
    .setDescription("Đổi biển số")
    .addStringOption(o =>
      o.setName("bienso").setDescription("Biển số mới").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng thời gian")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Phút").setRequired(true))
    .addStringOption(o =>
      o.setName("type").setDescription("Loại").setRequired(true)
      .addChoices(
        { name: "Onduty ngày", value: "day" },
        { name: "Thực tập tổng", value: "total" }
      )
    ),

  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ thời gian")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Phút").setRequired(true))
    .addStringOption(o =>
      o.setName("type").setDescription("Loại").setRequired(true)
      .addChoices(
        { name: "Onduty ngày", value: "day" },
        { name: "Thực tập tổng", value: "total" }
      )
    ),

  new SlashCommandBuilder()
    .setName("forced_duty")
    .setDescription("Force off")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))

].map(c => c.toJSON());

// ===== READY =====
client.once("clientReady", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Bot ready");
});

// ===== COMMAND =====
client.on("interactionCreate", async i => {
  try {
    if (!i.isChatInputCommand()) return;

    if (i.channel.id !== ALLOWED_CHANNEL_ID)
      return i.reply({ content: "Sai kênh", ephemeral: true });

    const member = await i.guild.members.fetch(i.user.id);
    const user = await getUser(member.id);
    const dayKey = dateKeyVN();

    if (i.commandName === "onduty") {
      if (!isPlayingGTA(member))
        return i.reply({ content: "❌ Vào Game Đi ĐM!", ephemeral: true });

      let day = user.days[dayKey];
      if (!day) day = user.days[dayKey] = { plate: "", sessions: [], messageId: null, channelId: null, extra: 0 };

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

    // giữ nguyên penalty, adjust, forced_duty y như bạn
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
    const id = member.id;

    const user = await getUser(id);
    const dayKey = dateKeyVN();
    const day = user.days[dayKey];
    if (!day) return;

    const isPlaying = isPlayingGTA(member);

    if (!isPlaying) {
      const last = day.sessions.find(s => !s.end);
      if (!last) return;

      last.end = Date.now();
      user.total += last.end - last.start;

      await saveUser(id, user);

      try {
        const ch = await client.channels.fetch(day.channelId);
        await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (ALT lấy lợi thế)");
      } catch {}
    }
  } catch (err) {
    console.error("AUTO GTA ERROR:", err);
  }
});

setInterval(async () => {
  try {
    const now = nowVN();

    if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

    const dayKey = dateKeyVN();

    const snap = await firebase.ref("users").once("value");
    const all = snap.val() || {};

    for (const id in all) {
      const user = all[id];
      const day = user.days?.[dayKey];
      if (!day) continue;

      const last = day.sessions?.find(s => !s.end);
      if (!last) continue;

      last.end = Date.now();
      user.total += last.end - last.start;

      await saveUser(id, user);

      try {
        const member = await client.guilds.cache
          .get(GUILD_ID)
          ?.members.fetch(id);

        const ch = await client.channels.fetch(day.channelId);

        await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Qua ngày mới)");
      } catch {}
    }
  } catch (err) {
    console.error("AUTO 23:59 ERROR:", err);
  }
}, 60000);

client.login(TOKEN);
