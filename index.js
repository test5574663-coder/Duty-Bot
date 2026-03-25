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

// ===== FIREBASE =====
const serviceAccount = JSON.parse(process.env.FIREBASE_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: process.env.FIREBASE_URL
});

const db = admin.firestore();

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const CLIENT_ID = process.env.CLIENT_ID;

const ROLE_MANAGER = process.env.ROLE_MANAGER;
const ROLE_INTERN = process.env.ROLE_INTERN;
const ROLE_EMPLOYEE = process.env.ROLE_EMPLOYEE;

const GTA_NAME = (process.env.GTA_ACTIVITY || "").toLowerCase();

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

// ===== HELPERS =====
function getOrCreateDay(user, dayKey) {
  if (!user.days[dayKey]) {
    user.days[dayKey] = {
      plate: "",
      sessions: [],
      extra: 0
    };
  }
  return user.days[dayKey];
}

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
  let total = 0;
  const now = Date.now();

  for (const s of day.sessions) {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "Đang trực"}\n`;
    total += end - s.start;
  }

  total += Math.max(0, day.extra || 0);

  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle("BẢNG ONDUTY")

    .setDescription(
`**Tên Nhân Sự:** ${member}

**Biển Số:** ${day.plate || "Chưa có"}

**Thời Gian Onduty:**
${timeline || "Chưa có dữ liệu"}

**Ngày Onduty:** ${dayKey}

**Tổng Thời Gian Onduty:** ${diffText(total)}

${member.roles.cache.has(ROLE_INTERN)
  ? `**Thực Tập:** ${diffText(user.total)} / 60h`
  : ""}

**Trạng Thái Hoạt Động:** ${status || "Không có"}`
    )

    .setTimestamp();
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
    } catch (err) {
      console.log("⚠️ Không update được:", err.message);
    }
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
  // ================= ONDUTY =================
  new SlashCommandBuilder()
    .setName("onduty")
    .setDescription("Bắt đầu ca trực")
    .addStringOption(o =>
      o.setName("bienso")
        .setDescription("Biển số xe")
        .setRequired(true)
    ),

  // ================= OFFDUTY =================
  new SlashCommandBuilder()
    .setName("offduty")
    .setDescription("Kết thúc ca trực"),

  // ================= THAY BIỂN =================
  new SlashCommandBuilder()
    .setName("thaybienso")
    .setDescription("Thay đổi biển số")
    .addStringOption(o =>
      o.setName("bienso")
        .setDescription("Biển số mới")
        .setRequired(true)
    ),

  // ================= PENALTY =================
  new SlashCommandBuilder()
    .setName("penalty")
    .setDescription("Cộng thời gian cho nhân sự")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Chọn nhân sự")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minute")
        .setDescription("Số phút cộng")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("options")
        .setDescription("Chọn loại thời gian")
        .setRequired(true)
        .addChoices(
          { name: "Onduty", value: "onduty" },
          { name: "Thực tập", value: "intern" }
        )
    ),

  // ================= ADJUST =================
  new SlashCommandBuilder()
    .setName("adjust")
    .setDescription("Trừ thời gian của nhân sự")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Chọn nhân sự")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minute")
        .setDescription("Số phút trừ")
        .setRequired(true)
        .setMinValue(1)
    )
    .addStringOption(o =>
      o.setName("options")
        .setDescription("Chọn loại thời gian")
        .setRequired(true)
        .addChoices(
          { name: "Onduty", value: "onduty" },
          { name: "Thực tập", value: "intern" }
        )
    ),

  // ================= FORCE OFF =================
  new SlashCommandBuilder()
    .setName("forceoff")
    .setDescription("Cưỡng chế kết thúc ca trực")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Chọn nhân sự cần force off")
        .setRequired(true)
    )
];

// ===== REGISTER =====
client.once("clientReady", async () => {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("🔄 Đăng ký lại command...");

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    {
      body: commands.map(c => c.toJSON())
    }
  );

  console.log("✅ Done");
});

// ===== COMMAND HANDLER =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;

  const member = await i.guild.members.fetch(i.user.id);
  const { ref, data: user } = await getUser(member.id);
  const day = getOrCreateDay(user, dateKey());

  // ONDUTY
  if (i.commandName === "onduty") {
  await i.deferReply({ ephemeral: true }); // 🔥 QUAN TRỌNG

  if (!isPlaying(member)) {
    return i.editReply("❌ Vào game trước");
  }


  if (day.sessions.some(s => !s.end)) {
    return i.editReply("❌ Đang trực");
  }

  day.plate = i.options.getString("bienso");
  day.sessions.push({ start: Date.now(), end: null });

  await saveUser(ref, user);
  await sendOrUpdate(i.channel, member, user, dateKey(), "🟢 Đang trực", ref);

  return i.editReply("✅ ON DUTY");
}

  // OFFDUTY
  if (i.commandName === "offduty") {
  await i.deferReply({ ephemeral: true });

  const last = day.sessions.find(s => !s.end);
  if (!last)
    return i.editReply("❌ Chưa ON");

  last.end = Date.now();
  user.total += last.end - last.start;

  await saveUser(ref, user);

  await sendOrUpdate(i.channel, member, user, dateKey(), "🔴 OFF", ref);

  return i.editReply("🔴 OFF DUTY");
}

  // THAY BIỂN
  if (i.commandName === "thaybienso") {
  await i.deferReply({ ephemeral: true });

  const last = day.sessions.find(s => !s.end);
  if (!last)
    return i.editReply("❌ Chưa ON");

  day.plate = i.options.getString("bienso");

  await saveUser(ref, user);
  await sendOrUpdate(i.channel, member, user, dateKey(), "🔄 Đổi biển", ref);

  return i.editReply("✅ Đã đổi");
}

  // PENALTY / ADJUST
  if (i.commandName === "penalty" || i.commandName === "adjust") {
  await i.deferReply({ ephemeral: false });

  if (!member.roles.cache.has(ROLE_MANAGER)) {
    return i.editReply("❌ Không có quyền");
  }

  const targetUser = i.options.getUser("user");
  const minute = i.options.getInteger("minute");
  const option = i.options.getString("options");

  const { ref: r, data: target } = await getUser(targetUser.id);
  const targetMember = await i.guild.members.fetch(targetUser.id);

  const d = getOrCreateDay(target, dateKey());

  const ms = minute * 60000;
  const add = i.commandName === "penalty";

  let status = "";

  // ===== ONDUTY =====
  if (option === "onduty") {
    d.extra += add ? ms : -ms;
    if (d.extra < 0) d.extra = 0;

    status = `${add ? "➕" : "➖"} ${minute} phút Onduty`;
  }

  // ===== INTERN =====
  if (option === "intern") {
    target.total += add ? ms : -ms;
    if (target.total < 0) target.total = 0;

    status = `${add ? "➕" : "➖"} ${minute} phút Thực tập`;
  }

  await saveUser(r, target);

  await sendOrUpdate(
    i.channel,
    targetMember,
    target,
    dateKey(),
    status,
    r
  );

  return i.editReply(`✅ ${status}`);
}

  // FORCE OFF
  if (i.commandName === "forceoff") {
    if (!member.roles.cache.has(ROLE_MANAGER))
      return i.reply({ content: "❌ Không có quyền", ephemeral: true });

    const targetUser = i.options.getUser("user");
    const { ref: r, data: target } = await getUser(targetUser.id);

    const d = target.days[dateKey()];
    if (!d)
      return i.reply({ content: "❌ Chưa ON", ephemeral: true });

    const last = d.sessions.find(s => !s.end);
    if (!last)
      return i.reply({ content: "❌ Đã OFF", ephemeral: true });

    last.end = Date.now();
    target.total += last.end - last.start;

    await saveUser(r, target);

    const targetMember = await i.guild.members.fetch(targetUser.id);

    await sendOrUpdate(i.channel, targetMember, target, dateKey(), "🚫 Force OFF", r);

    return i.reply({ content: "🚫 Force OFF" });
  }
});

//================ Alt lay loi the ===========================
client.on("presenceUpdate", async (oldP, newP) => {
  const member = newP?.member;
  if (!member) return;

  const wasPlaying = oldP?.activities?.some(a =>
    a.name?.toLowerCase().includes(GTA_NAME)
  );

  const isNowPlaying = newP?.activities?.some(a =>
    a.name?.toLowerCase().includes(GTA_NAME)
  );

  // 👉 từ chơi → không chơi
  if (wasPlaying && !isNowPlaying) {
    const { ref, data: user } = await getUser(member.id);
    const dayKeyNow = dateKey();
    const day = user.days[dayKeyNow];

    if (!day) return;

    const last = day.sessions.find(s => !s.end);
    if (!last) return;

    last.end = Date.now();
    user.total += last.end - last.start;

    await saveUser(ref, user);

    if (day.channelId) {
      const ch = await client.channels.fetch(day.channelId);
      await sendOrUpdate(ch, member, user, dayKeyNow, "🔴 Tự off (Alt lấy lợi thế)", ref);
    }
  }
});

//===============/New Day/==================
setInterval(async () => {
  const now = nowVN();
  if (now.getHours() !== 0 || now.getMinutes() !== 0) return;

  console.log("🌙 Reset ngày mới...");

  const docs = await db.collection("onduty").listDocuments();

  for (const doc of docs) {
    const snap = await doc.get();
    const user = snap.data();

    const keys = Object.keys(user.days || {});
    const lastKey = keys[keys.length - 1];

    const day = user.days[lastKey];
    if (!day) continue;

    const last = day.sessions.find(s => !s.end);
    if (!last) continue;

    last.end = Date.now();
    user.total += last.end - last.start;

    await doc.set(user);

    if (day.channelId) {
      const member = await client.guilds.cache.first().members.fetch(doc.id);
      const ch = await client.channels.fetch(day.channelId);

      await sendOrUpdate(ch, member, user, lastKey, "🌙 Tự off (qua ngày mới)", doc);
    }
  }
}, 60000);

// ===== START =====
client.login(TOKEN);
