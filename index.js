const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require("discord.js");

// ===== HTTP SERVER (Render Web Service) =====
require("http")
  .createServer((req, res) => res.end("Bot alive"))
  .listen(process.env.PORT || 3000);

// ===== CONFIG =====
const TOKEN = process.env.TOKEN;

const GUILD_ID = "1466476014908473550";
const LOG_CHANNEL_ID = "1472440293940002828";

const ROLE_STAFF = "1475815959616032883";
const ROLE_TRAINEE = "1467725396433834149";

const GTA_KEYWORD = "GTA5VN"; // chữ trong status

// ===== BOT =====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildPresences],
});

const dutyData = new Map();

// ===== TIME GMT+7 =====
function vnNow() {
  return new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
}

function formatDate(date) {
  return date.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function formatTime(date) {
  return date.toLocaleTimeString("vi-VN", {
    hour12: false,
    timeZone: "Asia/Ho_Chi_Minh",
  });
}

function calcDuration(start, end) {
  const diff = end - start;
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h} giờ ${m} phút`;
}

// ===== GTA DETECT =====
function hasGTA(member) {
  if (!member.presence) return false;
  return member.presence.activities.some(
    (a) => a.type === ActivityType.Playing && a.name.includes(GTA_KEYWORD)
  );
}

// ===== ONDUTY =====
function startDuty(member, plate) {
  dutyData.set(member.id, {
    plate,
    start: vnNow(),
    lastActivity: Date.now(),
  });
}

// ===== OFFDUTY =====
async function endDuty(member, reason = "Thoát GTA") {
  const data = dutyData.get(member.id);
  if (!data) return;

  const end = vnNow();

  const guild = client.guilds.cache.get(GUILD_ID);
  const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);

  const embed = new EmbedBuilder()
    .setColor(0x00ffcc)
    .setDescription(
`**Tên Nhân Sự :** <@${member.id}>
**Biển Số :** ${data.plate}
**Thời Gian Onduty :** ${formatTime(data.start)} → ${formatTime(end)}
**Ngày Onduty :** ${formatDate(data.start)}
**Tổng Thời Gian Onduty :** ${calcDuration(data.start, end)}
**Trạng Thái Hoạt Động :** ${reason}`
    )
    .setTimestamp();

  logChannel.send({ embeds: [embed] });

  dutyData.delete(member.id);
}

// ===== STATUS WATCH =====
setInterval(() => {
  const now = Date.now();

  dutyData.forEach((data, userId) => {
    const guild = client.guilds.cache.get(GUILD_ID);
    const member = guild.members.cache.get(userId);
    if (!member) return;

    // nếu không còn GTA
    if (!hasGTA(member)) {
      endDuty(member, "Thoát GTA");
      return;
    }

    // nếu GTA không đổi 10 phút
    if (now - data.lastActivity > 10 * 60 * 1000) {
      endDuty(member, "AFK GTA 10 phút");
    }
  });
}, 60000);

// ===== PRESENCE UPDATE =====
client.on("presenceUpdate", (oldP, newP) => {
  if (!newP) return;
  const member = newP.member;
  if (!member) return;

  const data = dutyData.get(member.id);
  if (!data) return;

  if (hasGTA(member)) {
    data.lastActivity = Date.now();
  }
});

// ===== SLASH =====
client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;

  const member = i.member;

  if (i.commandName === "onduty") {
    const plate = i.options.getString("bienso");

    if (!hasGTA(member)) {
      return i.reply({ content: "Vào Game Đi ĐM!.", ephemeral: true });
    }

    if (dutyData.has(member.id)) {
      return i.reply({ content: "Bạn đã onduty.", ephemeral: true });
    }

    startDuty(member, plate);

    i.reply({ content: "Đã bắt đầu onduty.", ephemeral: true });
  }

  if (i.commandName === "offduty") {
    if (!dutyData.has(member.id)) {
      return i.reply({ content: "Bạn chưa onduty.", ephemeral: true });
    }

    await endDuty(member, "Off thủ công");

    i.reply({ content: "Đã offduty.", ephemeral: true });
  }
});

// ===== READY =====
client.once("ready", () => console.log("Bot ready"));

client.login(TOKEN);
