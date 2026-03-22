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
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_DB_URL // 👈 SET TRONG .env https://anhlame-occhohehe1-default-rtdb.asia-southeast1.firebasedatabase.app/
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

// ===== SEND / UPDATE =====
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
    .addStringOption(o => o.setName("bienso").setRequired(true)),

  new SlashCommandBuilder().setName("offduty"),

  new SlashCommandBuilder()
    .setName("thaybienso")
    .addStringOption(o => o.setName("bienso").setRequired(true)),

  new SlashCommandBuilder()
    .setName("penalty")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setRequired(true))
    .addStringOption(o =>
      o.setName("type").setRequired(true).addChoices(
        { name: "day", value: "day" },
        { name: "total", value: "total" }
      )
    ),

  new SlashCommandBuilder()
    .setName("adjust")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setRequired(true))
    .addStringOption(o =>
      o.setName("type").setRequired(true).addChoices(
        { name: "day", value: "day" },
        { name: "total", value: "total" }
      )
    ),

  new SlashCommandBuilder()
    .setName("forced_duty")
    .addUserOption(o => o.setName("user").setRequired(true))

].map(c => c.toJSON());

// ===== READY =====
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
  console.log("Bot ready");
});

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  if (i.channel.id !== ALLOWED_CHANNEL_ID)
    return i.reply({ content: "Sai kênh", ephemeral: true });

  const member = await i.guild.members.fetch(i.user.id);
  const user = await getUser(member.id);
  const dayKey = dateKeyVN();

  if (i.commandName === "onduty") {
    const playing = (member.presence?.activities || []).some(a => a.name?.toLowerCase().includes("gta"));
    if (!playing) return i.reply({ content: "Vào GTA đi", ephemeral: true });

    let day = user.days[dayKey];
    if (!day) day = user.days[dayKey] = { plate: "", sessions: [], messageId: null, channelId: null, extra: 0 };

    if (day.sessions.some(s => !s.end)) return i.reply({ content: "Đang trực", ephemeral: true });

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

  if (i.commandName === "penalty") {
    if (!member.roles.cache.has(RESET_ROLE_ID)) return i.reply({ content: "Không quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const minutes = i.options.getInteger("minutes");
    const type = i.options.getString("type");

    const target = await getUser(u.id);
    const ms = minutes * 60000;

    if (type === "total") target.total += ms;
    if (type === "day") {
      const day = target.days[dayKey];
      if (day) day.extra = (day.extra || 0) + ms;
    }

    await saveUser(u.id, target);

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Penalty");

    return i.reply(`OK ${u}`);
  }

  if (i.commandName === "adjust") {
    if (!member.roles.cache.has(RESET_ROLE_ID)) return i.reply({ content: "Không quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const minutes = i.options.getInteger("minutes");
    const type = i.options.getString("type");

    const target = await getUser(u.id);
    const ms = minutes * 60000;

    if (type === "total") target.total = Math.max(0, target.total - ms);
    if (type === "day") {
      const day = target.days[dayKey];
      if (day) day.extra = Math.max(0, (day.extra || 0) - ms);
    }

    await saveUser(u.id, target);

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Adjust");

    return i.reply(`OK ${u}`);
  }

  if (i.commandName === "forced_duty") {
    if (!member.roles.cache.has(RESET_ROLE_ID)) return i.reply({ content: "Không quyền", ephemeral: true });

    const u = i.options.getUser("user");
    const target = await getUser(u.id);
    const day = target.days[dayKey];

    if (!day) return i.reply("Chưa trực");

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply("Đã off");

    last.end = Date.now();
    target.total += last.end - last.start;

    await saveUser(u.id, target);

    const m = await i.guild.members.fetch(u.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, "Force Off");

    return i.reply(`OK ${u}`);
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (oldP, newP) => {
  if (!newP?.member) return;

  const id = newP.member.id;
  const user = await getUser(id);
  const dayKey = dateKeyVN();
  const day = user.days[dayKey];
  if (!day) return;

  const playing = (newP.member.presence?.activities || []).some(a => a.name?.toLowerCase().includes("gta"));

  if (!playing) {
    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;

    await saveUser(id, user);

    try {
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, newP.member, user, dayKey, "Tự off GTA");
    } catch {}
  }
});

// ===== AUTO OFF 23:59 =====
setInterval(async () => {
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
      const member = await client.guilds.cache.get(GUILD_ID)?.members.fetch(id);
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off qua ngày");
    } catch {}
  }
}, 60000);

client.login(TOKEN);
