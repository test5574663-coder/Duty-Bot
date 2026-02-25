require("dotenv").config();
const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, Routes, REST } = require("discord.js");

const TOKEN = process.env.TOKEN;

// ===== CONFIG =====
const GUILD_ID = "1466476014908473550";
const RESET_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";
const STAFF_ROLE_ID = "1467724655766012129";

const PORT = process.env.PORT || 3000;

// ===== WEB SERVICE =====
require("http").createServer((req, res) => res.end("OK")).listen(PORT);

// ===== CLIENT =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== DATA =====
const dutyToday = new Map(); // ngày hiện tại
const dutyTotal = new Map(); // tổng nhiều ngày
const dutyMsg = new Map();   // embed id

// ===== TIME VN =====
function nowVN() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}

function formatTime(d) {
  return d.toLocaleTimeString("vi-VN", { hour12: false });
}

function formatDate(d) {
  return d.toLocaleDateString("vi-VN");
}

function diffText(ms) {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h} giờ ${m} phút`;
}

// ===== GTA CHECK =====
function isPlayingGTA(member) {
  const presence = member.presence;
  if (!presence) return false;
  return presence.activities?.some(a => a.name?.toLowerCase().includes("gta"));
}

// ===== EMBED =====
function buildEmbed(member, data, status, totalAll, isIntern) {
  const now = nowVN();

  let timeline = "";
  let totalDay = 0;

  data.sessions.forEach(s => {
    const end = s.end || now;
    timeline += `${formatTime(s.start)} ➝ ${s.end ? formatTime(s.end) : "..."}\n`;
    totalDay += end - s.start;
  });

  return new EmbedBuilder()
    .setColor("#00ff9c")
    .setAuthor({ name: "BẢNG ONDUTY" })
    .setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${data.plate}

**Thời Gian Onduty :**
${timeline}

**Ngày Onduty :** ${data.date}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern ? `\n**Tổng Thời Gian Thực Tập :** ${diffText(totalAll)}` : ""}

**Trạng Thái Hoạt Động :** ${status}`
    );
}

// ===== SLASH =====
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
    .setName("ofduty")
    .setDescription("Kết thúc trực"),

  new SlashCommandBuilder()
    .setName("resetduty")
    .setDescription("Reset duty")
    .addUserOption(o =>
      o.setName("user")
       .setDescription("Chọn người")
       .setRequired(true)
    )
].map(c => c.toJSON());

client.once("clientReady", async () => {
  console.log("Bot ready");

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
});

// ===== ON/OFF =====
client.on("interactionCreate", async i => {
  if (!i.isChatInputCommand()) return;
  const member = i.member;

  // ===== ONDUTY =====
  if (i.commandName === "onduty") {

    if (!isPlayingGTA(member))
      return i.reply({ content: "❌ Bạn phải đang trong GTA", ephemeral: true });

    const plate = i.options.getString("bienso");
    const today = formatDate(nowVN());

    let data = dutyToday.get(member.id);

    if (!data || data.date !== today) {
      data = { date: today, plate, sessions: [], lastGame: Date.now() };
      dutyToday.set(member.id, data);
    }

    data.plate = plate;
    data.sessions.push({ start: nowVN(), end: null });

    const totalAll = dutyTotal.get(member.id) || 0;
    const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

    const embed = buildEmbed(member, data, "Đang trực", totalAll, isIntern);

    const old = dutyMsg.get(member.id);
    if (old) {
      try {
        const ch = await client.channels.fetch(old.channelId);
        const msg = await ch.messages.fetch(old.messageId);
        await msg.edit({ embeds: [embed] });
      } catch {}
    } else {
      const msg = await i.channel.send({ embeds: [embed] });
      dutyMsg.set(member.id, { channelId: msg.channelId, messageId: msg.id });
    }

    return i.reply({ content: "Onduty thành công", ephemeral: true });
  }

  // ===== OFDUTY =====
  if (i.commandName === "ofduty") {
    const data = dutyToday.get(member.id);
    if (!data) return i.reply({ content: "Bạn chưa onduty", ephemeral: true });

    const last = data.sessions[data.sessions.length - 1];
    if (last && !last.end) last.end = nowVN();

    // cộng tổng
    const duration = last.end - last.start;
    dutyTotal.set(member.id, (dutyTotal.get(member.id) || 0) + duration);

    const totalAll = dutyTotal.get(member.id);
    const isIntern = member.roles.cache.has(INTERN_ROLE_ID);

    // đủ 60h
    if (isIntern && totalAll >= 60 * 60 * 1000) {
      await member.roles.add(STAFF_ROLE_ID);
      await member.roles.remove(INTERN_ROLE_ID);
      i.channel.send(`🎉 Chúc mừng ${member} đã trở thành Nhân Viên chính thức!`);
    }

    const embed = buildEmbed(member, data, "Off", totalAll, isIntern);

    const old = dutyMsg.get(member.id);
    if (old) {
      try {
        const ch = await client.channels.fetch(old.channelId);
        const msg = await ch.messages.fetch(old.messageId);
        await msg.edit({ embeds: [embed] });
      } catch {}
    }

    return i.reply({ content: "Đã offduty", ephemeral: true });
  }

  // ===== RESET =====
  if (i.commandName === "resetduty") {
    if (!member.roles.cache.has(RESET_ROLE_ID))
      return i.reply({ content: "Không có quyền", ephemeral: true });

    const user = i.options.getUser("user");
    dutyToday.delete(user.id);
    dutyTotal.delete(user.id);
    dutyMsg.delete(user.id);

    return i.reply(`Đã reset duty ${user}`);
  }
});

// ===== AUTO OFF GTA =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP) return;

  const id = newP.userId;
  const data = dutyToday.get(id);
  if (!data) return;

  const playing = newP.activities?.some(a => a.name?.toLowerCase().includes("gta"));

  if (playing) {
    data.lastGame = Date.now();
    return;
  }

  if (Date.now() - data.lastGame > 10 * 60 * 1000) {
    const last = data.sessions[data.sessions.length - 1];
    if (last && !last.end) last.end = nowVN();

    dutyTotal.set(id, (dutyTotal.get(id) || 0) + (last.end - last.start));

    dutyToday.delete(id);
  }
});

// ===== LOGIN =====
client.login(TOKEN);
