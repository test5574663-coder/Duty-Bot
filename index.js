require("dotenv").config();
const admin = require("firebase-admin");

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  Routes,
  REST
} = require("discord.js");

// ===== TOKEN =====
const TOKEN = process.env.DISCORD_TOKEN;

// ===== FIREBASE =====
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://anhlame-occhohehe1-default-rtdb.asia-southeast1.firebasedatabase.app/"
});

const dbRef = admin.database().ref("onduty");

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";

// ===== LOCAL CACHE =====
let db = {};

// ===== LOAD DB =====
async function loadDB() {
  const snap = await dbRef.get();
  db = snap.val() || {};
}

// ===== SAVE DB =====
async function saveDB() {
  await dbRef.set(db);
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

// ===== USER =====
function getUser(id) {
  if (!db[id]) db[id] = { total: 0, days: {} };
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
`**Tên Nhân Sự :** <@${member.id}>

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
  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);
  if (!embed) return;

  // 👉 chỉ để tag user phục vụ search
  const content = `<@${member.id}>`;

  // ===== UPDATE MESSAGE =====
  if (day.messageId && day.channelId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);

      if (msg) {
        await msg.edit({
          content: content,
          embeds: [embed]
        });
        return;
      }
    } catch {}
  }

  // ===== SEND NEW =====
  const msg = await channel.send({
    content: content,
    embeds: [embed]
  });

  day.messageId = msg.id;
  day.channelId = channel.id;

  await saveDB();
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o =>
      o.setName("bienso")
        .setDescription("Biển số xe")
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
        .setDescription("Người bị cộng")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Số phút")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Loại thời gian")
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
        .setDescription("Người bị trừ")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Số phút")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Loại thời gian")
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
        .setDescription("Người bị off")
        .setRequired(true)
    )

].map(c => c.toJSON());

// ===== READY =====
client.once("ready", async () => {
  console.log("🔄 Đang load database...");
  await loadDB();

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  try {
    console.log("🔄 Đang refresh slash command...");

    // ❗ clear command cũ
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: [] }
    );

    // ❗ đăng ký lại command
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, GUILD_ID),
      { body: commands }
    );

    console.log("✅ Slash command đã load xong");
  } catch (err) {
    console.error("❌ Lỗi load command:", err);
  }

  console.log(`🔥 Bot ready: ${client.user.tag}`);
});

// ===== LOGIN =====
client.login(TOKEN);
