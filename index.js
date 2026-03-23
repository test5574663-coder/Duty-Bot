require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const admin = require("firebase-admin");

// ===== FIREBASE (JSON 1 dòng) =====
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

const db = admin.firestore();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;

const ROLE_MANAGER = process.env.ROLE_MANAGER;
const ROLE_INTERN = process.env.ROLE_INTERN;
const ROLE_EMPLOYEE = process.env.ROLE_EMPLOYEE;

const GTA_NAME = process.env.GTA_ACTIVITY.toLowerCase();

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// ===== TIME =====
const nowVN = () =>
  new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));

const dateKey = () => nowVN().toLocaleDateString("vi-VN");

const formatTime = ms =>
  new Date(ms).toLocaleTimeString("vi-VN", { hour12: false });

const diffText = ms => {
  const m = Math.floor(ms / 60000);
  return `${Math.floor(m / 60)} giờ ${m % 60} phút`;
};

// ===== FIREBASE =====
async function getUser(userId) {
  const ref = db.collection("onduty").doc(userId);
  const doc = await ref.get();

  if (!doc.exists) {
    const data = { total: 0, days: {} };
    await ref.set(data);
    return { ref, data };
  }

  return { ref, data: doc.data() };
}

async function saveUser(ref, data) {
  await ref.set(data);
}

// ===== ROLE AUTO =====
async function checkIntern(member, user) {
  const limit = 60 * 60 * 1000;

  if (user.total >= limit && member.roles.cache.has(ROLE_INTERN)) {
    await member.roles.remove(ROLE_INTERN);
    await member.roles.add(ROLE_EMPLOYEE);
  }
}

// ===== GTA CHECK =====
function isPlaying(member) {
  const activities = member.presence?.activities || [];
  return activities.some(a =>
    a.name?.toLowerCase().includes(GTA_NAME)
  );
}

// ===== EMBED =====
function buildEmbed(member, user, dayKey, status) {
  const day = user.days[dayKey];
  if (!day) return null;

  let timeline = "";
  let totalDay = 0;
  const now = Date.now();

  for (const s of day.sessions) {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "..."}\n`;
    totalDay += end - s.start;
  }

  if (day.extra) totalDay += day.extra;

  const isIntern = member.roles.cache.has(ROLE_INTERN);

  return new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(status.includes("Off") ? 0xff4d4f : 0x00ff9c)
    .setDescription(
`**Tên Nhân Sự:** ${member}

**Biển Số:** ${day.plate || "Chưa nhập"}

**Thời Gian Onduty:**
${timeline || "Chưa có"}

**Ngày:** ${dayKey}

**Tổng Hôm Nay:** ${diffText(totalDay)}
${isIntern ? `\n**Thực Tập:** ${diffText(user.total)} / 60h` : ""}

**Trạng Thái:** ${status}`
    );
}

// ===== SEND / UPDATE =====
async function sendOrUpdate(channel, member, user, dayKey, status, ref) {
  const day = user.days[dayKey];
  const embed = buildEmbed(member, user, dayKey, status);

  if (!embed) return;

  if (day.messageId && day.channelId) {
    try {
      const ch = await client.channels.fetch(day.channelId);
      const msg = await ch.messages.fetch(day.messageId);

      await msg.edit({
        content: `<@${member.id}>`,
        embeds: [embed]
      });
      return;
    } catch {}
  }

  const msg = await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed]
  });

  day.messageId = msg.id;
  day.channelId = channel.id;

  await saveUser(ref, user);
}

// ===== COMMANDS =====
const commands = [
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu trực")
    .addStringOption(o => o.setName("bienso").setRequired(true)),

  new SlashCommandBuilder().setName("offduty").setDescription("Kết thúc"),

  new SlashCommandBuilder()
    .setName("thay")
    .setDescription("Đổi biển số")
    .addStringOption(o => o.setName("bienso").setRequired(true)),

  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng giờ")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minute").setRequired(true))
    .addStringOption(o =>
      o.setName("options").setRequired(true)
        .addChoices(
          { name: "Thoi Gian Onduty", value: "onduty" },
          { name: "Thoi Gian Thuc Tap", value: "intern" }
        )
    ),

  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ giờ")
    .addUserOption(o => o.setName("user").setRequired(true))
    .addIntegerOption(o => o.setName("minute").setRequired(true))
    .addStringOption(o =>
      o.setName("options").setRequired(true)
        .addChoices(
          { name: "Thoi Gian Onduty", value: "onduty" },
          { name: "Thoi Gian Thuc Tap", value: "intern" }
        )
    ),

  new SlashCommandBuilder()
    .setName("forceoff")
    .setDescription("Cưỡng chế off")
    .addUserOption(o => o.setName("user").setRequired(true))
].map(c => c.toJSON());

// ===== REGISTER =====
client.once("ready", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, GUILD_ID),
    { body: commands }
  );
  console.log("Bot ready");
});

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = await i.guild.members.fetch(i.user.id);
  const { ref, data: user } = await getUser(member.id);
  const dayKey = dateKey();

  // ===== ONDUTY =====
  if (i.commandName === "onduty") {
    if (!isPlaying(member))
      return i.reply({ content: "❌ Vào game đi ĐM!", ephemeral: true });

    let day = user.days[dayKey];
    if (!day) {
      day = user.days[dayKey] = {
        plate: "",
        sessions: [],
        extra: 0
      };
    }

    if (day.sessions.some(s => !s.end))
      return i.reply("❌ Đang trực");

    day.plate = i.options.getString("bienso");
    day.sessions.push({ start: Date.now(), end: null });

    await saveUser(ref, user);
    await sendOrUpdate(i.channel, member, user, dayKey, "Đang trực", ref);

    return i.reply({ content: "✅ ON DUTY", ephemeral: true });
  }

  // ===== OFFDUTY =====
  if (i.commandName === "offduty") {
    const day = user.days[dayKey];
    if (!day) return i.reply("❌ Chưa ON");

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply("❌ Đã OFF");

    last.end = Date.now();
    user.total += last.end - last.start;

    await checkIntern(member, user);

    await saveUser(ref, user);
    await sendOrUpdate(i.channel, member, user, dayKey, "Off", ref);

    return i.reply("🔴 OFF DUTY");
  }

  // ===== THAY BIỂN =====
  if (i.commandName === "thay") {
    const day = user.days[dayKey];
    if (!day) return i.reply("❌ Chưa ON");

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply("❌ Chưa ON");

    day.plate = i.options.getString("bienso");

    await saveUser(ref, user);
    await sendOrUpdate(i.channel, member, user, dayKey, "Đang trực", ref);

    return i.reply("✅ Đã đổi biển");
  }

  // ===== PENALTY / ADJUST =====
  if (["penalty", "adjust"].includes(i.commandName)) {
    if (!member.roles.cache.has(ROLE_MANAGER))
      return i.reply("❌ Không có quyền");

    const targetUser = i.options.getUser("user");
    const minute = i.options.getInteger("minute");
    const type = i.options.getString("options");

    const { ref, data: target } = await getUser(targetUser.id);

    const ms = minute * 60000;

    if (type === "onduty") {
      const day = target.days[dayKey] || (target.days[dayKey] = { sessions: [], extra: 0 });
      day.extra = (day.extra || 0) + (i.commandName === "penalty" ? ms : -ms);
      if (day.extra < 0) day.extra = 0;
    }

    if (type === "intern") {
      target.total += i.commandName === "penalty" ? ms : -ms;
      if (target.total < 0) target.total = 0;
    }

    const m = await i.guild.members.fetch(targetUser.id);
    await checkIntern(m, target);

    await saveUser(ref, target);
    await sendOrUpdate(i.channel, m, target, dayKey, i.commandName, ref);

    return i.reply("✅ Done");
  }

  // ===== FORCE OFF =====
  if (i.commandName === "forceoff") {
    if (!member.roles.cache.has(ROLE_MANAGER))
      return i.reply("❌ Không có quyền");

    const targetUser = i.options.getUser("user");
    const { ref, data: target } = await getUser(targetUser.id);

    const day = target.days[dayKey];
    if (!day) return i.reply("❌ User chưa ON");

    const last = day.sessions.find(s => !s.end);
    if (!last) return i.reply("❌ User đã OFF");

    last.end = Date.now();
    target.total += last.end - last.start;

    await saveUser(ref, target);

    const m = await i.guild.members.fetch(targetUser.id);
    await sendOrUpdate(i.channel, m, target, dayKey, "Force Off", ref);

    return i.reply("🚫 Force OFF");
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", async (_, newP) => {
  if (!newP?.member) return;

  const member = newP.member;
  const { ref, data: user } = await getUser(member.id);

  const dayKey = dateKey();
  const day = user.days[dayKey];
  if (!day) return;

  if (!isPlaying(member)) {
    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;

    await saveUser(ref, user);

    const ch = await client.channels.fetch(day.channelId);
    await sendOrUpdate(ch, member, user, dayKey, "Tự off (Alt lấy lợi thế)", ref);
  }
});

// ===== AUTO OFF QUA NGÀY =====
setInterval(async () => {
  const now = nowVN();
  if (now.getHours() !== 23 || now.getMinutes() !== 59) return;

  const guild = client.guilds.cache.get(GUILD_ID);
  if (!guild) return;

  for (const [id] of await db.collection("onduty").listDocuments()) {
    const { ref, data: user } = await getUser(id.id);
    const dayKey = dateKey();

    const day = user.days[dayKey];
    if (!day) continue;

    const last = day.sessions.find(s => !s.end);
    if (!last) continue;

    last.end = Date.now();
    user.total += last.end - last.start;

    const member = await guild.members.fetch(id.id);
    await saveUser(ref, user);

    const ch = await client.channels.fetch(day.channelId);
    await sendOrUpdate(ch, member, user, dayKey, "Tự off (Qua ngày mới)", ref);
  }
}, 60000);

client.login(TOKEN);
