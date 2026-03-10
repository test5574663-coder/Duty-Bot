require("dotenv").config();

const fs = require("fs");
const http = require("http");
const https = require("https");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";

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

// ===== DATABASE =====
const DB_FILE = "./duty.json";
let db = {};

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE));
  }
}

function saveDB() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

loadDB();

// ===== TIME VN =====
function nowVN() {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Asia/Ho_Chi_Minh"
    })
  );
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

// ===== USER =====
function getUser(id) {
  if (!db[id]) {
    db[id] = {
      total: 0,
      days: {}
    };
  }
  return db[id];
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

// ===== UPDATE EMBED =====
async function sendOrUpdateEmbed(channel, member, user, dayKey, status) {

  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);

  if (!embed) return;

  if (day.messageId && day.channelId) {

    try {

      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);

      if (msg) {
        await msg.edit({ embeds: [embed] });
        return;
      }

    } catch {}

  }

  const msg = await channel.send({ embeds: [embed] });

  day.messageId = msg.id;
  day.channelId = channel.id;

  saveDB();
}

// ===== COMMANDS =====
const commands = [

  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso")
       .setDescription("Biển số")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("thaybienso")
    .setDescription("Đổi biển số khi đang trực")
    .addStringOption(o =>
      o.setName("bienso")
       .setDescription("Biển số mới")
       .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng thời gian")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("User")
       .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
       .setDescription("Phút")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
       .setDescription("Loại")
       .setRequired(true)
       .addChoices(
         { name: "Onduty ngày", value: "day" },
         { name: "Thực tập tổng", value: "total" }
       )
    ),

  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ thời gian")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("User")
       .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
       .setDescription("Phút")
       .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
       .setDescription("Loại")
       .setRequired(true)
       .addChoices(
         { name: "Onduty ngày", value: "day" },
         { name: "Thực tập tổng", value: "total" }
       )
    ),

  new SlashCommandBuilder()
    .setName("forced_duty")
    .setDescription("Cưỡng chế offduty")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("User")
       .setRequired(true)
    )

].map(c => c.toJSON());

// ===== READY =====
client.once("ready", async () => {

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );

  console.log("BOT READY");

});

client.login(TOKEN);
