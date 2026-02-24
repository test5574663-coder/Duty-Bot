const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;

// ====== CONFIG ======
const RESET_ROLES = ["1475815959616032883"];
const INTERN_ROLE = "1467725396433834149";
const EMPLOYEE_ROLE = "1467724655766012129";
const PROMOTE_CHANNEL = "1467729036066295820";
const GAME_NAME = "GTA5VN";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

let db = {};
if (fs.existsSync("data.json")) db = JSON.parse(fs.readFileSync("data.json"));

function save() {
  fs.writeFileSync("data.json", JSON.stringify(db, null, 2));
}

function now() {
  return new Date();
}

function formatDate(d) {
  return d.toLocaleDateString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
}

function formatHM(d) {
  return `${d.getHours()}h${d.getMinutes()}`;
}

function secToHM(sec) {
  let h = Math.floor(sec / 3600);
  let m = Math.floor((sec % 3600) / 60);
  return `${h}h${m}`;
}

function isPlaying(member) {
  return member.presence?.activities?.some(a => a.name === GAME_NAME);
}

function getUser(guild, id) {
  if (!db[guild]) db[guild] = {};
  if (!db[guild][id]) {
    db[guild][id] = {
      sessions: [],
      today: 0,
      totalIntern: 0,
      start: null,
      plate: "",
      msg: null,
      lastActive: Date.now()
    };
  }
  return db[guild][id];
}

async function updateEmbed(interaction, member, data, off = false) {
  const date = formatDate(new Date());

  let timeline = data.sessions.map(s =>
    `${formatHM(new Date(s.start))}→${formatHM(new Date(s.end))}`
  ).join("\n") || "Chưa có";

  let embed = new EmbedBuilder()
    .setTitle("📋 BẢNG ONDUTY")
    .setColor(off ? 0xff0000 : 0x00ff00)
    .setDescription(
`Tên Nhân Sự : ${member.user.username}
Biển Số : ${data.plate || "Chưa ghi"}
Thời Gian Onduty :
${timeline}
Ngày Onduty : ${date}
Tổng Thời Gian Onduty : ${secToHM(data.today)}
Trạng Thái Hoạt Động : ${off ? "🔴 Off duty" : "🟢 On duty"}`
    )
    .setTimestamp();

  if (member.roles.cache.has(INTERN_ROLE)) {
    embed.addFields({
      name: "Tổng thời gian thực tập",
      value: secToHM(data.totalIntern),
      inline: false
    });
  }

  if (!data.msg) {
    let m = await interaction.channel.send({ embeds: [embed] });
    data.msg = m.id;
  } else {
    let m = await interaction.channel.messages.fetch(data.msg).catch(() => null);
    if (m) await m.edit({ embeds: [embed] });
  }
}

async function checkPromote(member, data) {
  if (!member.roles.cache.has(INTERN_ROLE)) return;
  if (data.totalIntern < 60 * 3600) return;

  if (!member.roles.cache.has(EMPLOYEE_ROLE)) {
    await member.roles.add(EMPLOYEE_ROLE);
    let ch = member.guild.channels.cache.get(PROMOTE_CHANNEL);
    if (ch) ch.send(`🎉 Chúc mừng ${member} đã đủ 60h và lên nhân viên!`);
  }
}

// ===== COMMANDS =====
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  const member = interaction.member;
  const guild = interaction.guild.id;
  const data = getUser(guild, member.id);

  if (interaction.commandName === "onduty") {

    if (!isPlaying(member))
      return interaction.reply({ content: "❌ Bạn chưa vào game!", ephemeral: true });

    if (data.start)
      return interaction.reply({ content: "Bạn đang onduty!", ephemeral: true });

    const plate = interaction.options.getString("bienso");
    if (plate) data.plate = plate;

    data.start = Date.now();
    data.lastActive = Date.now();

    await interaction.reply({ content: "🟢 Bắt đầu onduty", ephemeral: true });
    await updateEmbed(interaction, member, data, false);
    save();
  }

  if (interaction.commandName === "offduty") {

    if (!data.start)
      return interaction.reply({ content: "Bạn chưa onduty!", ephemeral: true });

    let end = Date.now();
    let sec = Math.floor((end - data.start) / 1000);

    data.sessions.push({ start: data.start, end });
    data.today += sec;
    data.totalIntern += sec;
    data.start = null;

    await interaction.reply({ content: "🔴 Off duty", ephemeral: true });
    await updateEmbed(interaction, member, data, true);
    await checkPromote(member, data);
    save();
  }

  if (interaction.commandName === "resetduty") {

    if (!member.roles.cache.some(r => RESET_ROLES.includes(r.id)))
      return interaction.reply({ content: "Không có quyền", ephemeral: true });

    data.sessions = [];
    data.today = 0;
    data.start = null;

    await interaction.reply({ content: "Đã reset duty", ephemeral: true });
    await updateEmbed(interaction, member, data, true);
    save();
  }
});

// ===== AUTO OFF GAME / TREO =====
setInterval(() => {
  for (let g in db) {
    for (let u in db[g]) {
      let data = db[g][u];
      if (!data.start) continue;

      let guild = client.guilds.cache.get(g);
      if (!guild) continue;

      let member = guild.members.cache.get(u);
      if (!member) continue;

      if (!isPlaying(member)) {
        let end = Date.now();
        let sec = Math.floor((end - data.start) / 1000);

        data.sessions.push({ start: data.start, end });
        data.today += sec;
        data.totalIntern += sec;
        data.start = null;

        save();
      }

      if (Date.now() - data.lastActive > 10 * 60 * 1000) {
        member.send("⚠️ Bạn treo onduty 10 phút!");
        data.lastActive = Date.now();
      }
    }
  }
}, 60000);

client.login(TOKEN);
