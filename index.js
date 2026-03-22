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

// ===== CACHE =====
let db = {};

// ===== DB =====
async function loadDB() {
  const snap = await dbRef.get();
  db = snap.val() || {};
}

function saveDB() {
  dbRef.set(db); // bỏ await để tránh lag
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

  const content = `<@${member.id}>`;

  if (day.messageId && day.channelId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);
      if (msg) {
        await msg.edit({ content, embeds: [embed] });
        return;
      }
    } catch {}
  }

  const msg = await channel.send({ content, embeds: [embed] });
  day.messageId = msg.id;
  day.channelId = channel.id;
  saveDB();
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o => o.setName("bienso").setDescription("Biển số").setRequired(true)),

  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("thaybienso")
    .setDescription("Đổi biển số")
    .addStringOption(o => o.setName("bienso").setRequired(true).setDescription("Biển số")),

  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng giờ")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setRequired(true))
    .addStringOption(o => o.setName("type").setRequired(true)
      .addChoices(
        { name: "Onduty ngày", value: "day" },
        { name: "Thực tập tổng", value: "total" }
      )),

  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ giờ")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setRequired(true))
    .addStringOption(o => o.setName("type").setRequired(true)
      .addChoices(
        { name: "Onduty ngày", value: "day" },
        { name: "Thực tập tổng", value: "total" }
      )),

  new SlashCommandBuilder()
    .setName("forced_duty")
    .setDescription("Force off")
    .addUserOption(o => o.setName("user").setRequired(true))
].map(c => c.toJSON());

// ===== READY =====
client.once("ready", async () => {
  await loadDB();

  const rest = new REST({ version: "10" }).setToken(TOKEN);

  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: [] });
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });

  console.log(`🔥 Bot ready: ${client.user.tag}`);
});

// ===== INTERACTION =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const adminCommands = ["penalty", "adjust", "forced_duty"];
  const isAdmin = adminCommands.includes(i.commandName);

  await i.deferReply({ ephemeral: !isAdmin });

  try {
    const member = await i.guild.members.fetch(i.user.id);
    const user = getUser(member.id);
    const dayKey = dateKeyVN();

    if (i.commandName === "onduty") {
      const playing = member.presence?.activities?.some(a =>
        a.name?.toLowerCase().includes("gta")
      );

      if (!playing) return i.editReply("❌ Vào Game Đi ĐM!");

      let day = user.days[dayKey] || (user.days[dayKey] = {
        plate: "",
        sessions: [],
        messageId: null,
        channelId: null,
        extra: 0
      });

      if (day.sessions.some(s => !s.end))
        return i.editReply("❌ Đang onduty rồi");

      day.plate = i.options.getString("bienso");
      day.sessions.push({ start: Date.now(), end: null });

      saveDB();
      await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Đang trực");

      return i.editReply("✅ Onduty thành công");
    }

    if (i.commandName === "offduty") {
      const day = user.days[dayKey];
      if (!day) return i.editReply("❌ Chưa onduty");

      const last = day.sessions.find(s => !s.end);
      if (!last) return i.editReply("❌ Đã off");

      last.end = Date.now();
      user.total += last.end - last.start;

      saveDB();
      await sendOrUpdateEmbed(i.channel, member, user, dayKey, "Off");

      return i.editReply("🛑 Đã off");
    }

    // ===== ADMIN =====
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.editReply("❌ Không có quyền");

    const targetUser = i.options.getUser("user");
    const target = getUser(targetUser.id);
    const minutes = i.options.getInteger("minutes") || 0;
    const type = i.options.getString("type");
    const ms = minutes * 60000;

    if (i.commandName === "penalty") {
      if (type === "total") target.total += ms;
      if (type === "day") {
        const d = target.days[dayKey];
        if (d) d.extra = (d.extra || 0) + ms;
      }
    }

    if (i.commandName === "adjust") {
      if (type === "total") target.total = Math.max(0, target.total - ms);
      if (type === "day") {
        const d = target.days[dayKey];
        if (d) d.extra = Math.max(0, (d.extra || 0) - ms);
      }
    }

    if (i.commandName === "forced_duty") {
      const d = target.days[dayKey];
      if (!d) return i.editReply("❌ Chưa onduty");

      const last = d.sessions.find(s => !s.end);
      if (!last) return i.editReply("❌ Đã off");

      last.end = Date.now();
      target.total += last.end - last.start;
    }

    saveDB();

    const m = await i.guild.members.fetch(targetUser.id);
    await sendOrUpdateEmbed(i.channel, m, target, dayKey, i.commandName);

    return i.editReply("✅ Done");

  } catch (err) {
    console.error(err);
    return i.editReply("❌ Lỗi bot");
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (oldP, newP) => {
  if (!newP?.member) return;

  const member = newP.member;
  const user = db[member.id];
  if (!user) return;

  const dayKey = dateKeyVN();
  const day = user.days[dayKey];
  if (!day) return;

  const playing = member.presence?.activities?.some(a =>
    a.name?.toLowerCase().includes("gta")
  );

  if (!playing) {
    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;

    saveDB();

    const ch = await client.channels.fetch(day.channelId);
    await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Alt lấy lợi thế)");
  }
});

// ===== AUTO OFF 23:59 =====
setInterval(async () => {
  const now = nowVN();
  if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

  const dayKey = dateKeyVN();

  for (const id in db) {
    const user = db[id];
    const day = user.days[dayKey];
    if (!day) continue;

    const last = day.sessions.find(s => !s.end);
    if (!last) continue;

    last.end = Date.now();
    user.total += last.end - last.start;

    saveDB();

    const member = await client.guilds.cache.get(GUILD_ID)?.members.fetch(id);
    const ch = await client.channels.fetch(day.channelId);

    await sendOrUpdateEmbed(ch, member, user, dayKey, "Tự off (Qua Ngày)");
  }
}, 60000);

client.login(TOKEN);
