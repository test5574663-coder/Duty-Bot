const { Client, GatewayIntentBits, EmbedBuilder, SlashCommandBuilder, REST, Routes } = require("discord.js");
const fs = require("fs");

const TOKEN = process.env.TOKEN;

const CHANNEL_ID = "1472440293940002828";
const ROLE_TT = "1467725396433834149";
const ROLE_NV = "1467724655766012129";
const ROLE_RESET = "1475815959616032883";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ]
});

// ===== COMMAND REGISTER =====
client.once("ready", async () => {
  console.log("Bot ready");

  const cmds = [
    new SlashCommandBuilder().setName("onduty").setDescription("Bắt đầu trực"),
    new SlashCommandBuilder().setName("offduty").setDescription("Kết thúc trực"),
    new SlashCommandBuilder()
      .setName("resetduty")
      .setDescription("Reset duty")
      .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
  ];

  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: cmds }
  );
});

// ===== DATA =====
const FILE = "./duty.json";
let duty = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE)) : {};
const save = () => fs.writeFileSync(FILE, JSON.stringify(duty, null, 2));

function ensure(id) {
  if (!duty[id]) {
    duty[id] = { on:false, start:0, lastChange:0, plate:"", ttMinutes:0 };
  }
}

function vnTime(d){
  return new Intl.DateTimeFormat("vi-VN",{
    timeZone:"Asia/Ho_Chi_Minh",
    hour:"2-digit",
    minute:"2-digit"
  }).format(d);
}

function isGTA(p){
  return p?.activities?.some(a=>a.name?.toLowerCase().includes("gta5vn"));
}

async function sendEmbed(member,type,start,end,min){
  const data=duty[member.id];
  const ttH=Math.floor(data.ttMinutes/60);

  let desc=`Tên nhân sự: ${member}

Biển số: ${data.plate||"Chưa khai báo"}

Thời gian onduty:
${vnTime(start)} → ${end?vnTime(end):"..."}

Tổng thời gian: ${min||0} phút

Trạng thái: ${type==="on"?"Đang trực":"Đã nghỉ"}`;

  if(member.roles.cache.has(ROLE_TT))
    desc+=`\n\nTổng thời gian thực tập: ${ttH} giờ`;

  const embed=new EmbedBuilder()
    .setColor(type==="on"?"Green":"Red")
    .setTitle(type==="on"?"BẢNG ONDUTY":"BẢNG OFFDUTY")
    .setDescription(desc);

  client.channels.cache.get(CHANNEL_ID)?.send({embeds:[embed]});
}

async function checkPromote(member){
  const data=duty[member.id];
  if(data.ttMinutes/60>=60 && member.roles.cache.has(ROLE_TT)){
    await member.roles.remove(ROLE_TT);
    await member.roles.add(ROLE_NV);
    client.channels.cache.get(CHANNEL_ID)
      ?.send(`🎉 ${member} đã trở thành Nhân viên!`);
  }
}

// ===== SLASH =====
client.on("interactionCreate", async i=>{
  if(!i.isChatInputCommand()) return;
  const m=i.member;
  ensure(m.id);

  if(i.commandName==="onduty"){
    if(!isGTA(i.member.presence))
      return i.reply({content:"Vào Game Đi ĐM",ephemeral:true});

    duty[m.id].on=true;
    duty[m.id].start=Date.now();
    duty[m.id].lastChange=Date.now();
    save();

    sendEmbed(m,"on",new Date());
    i.reply({content:"Đã onduty",ephemeral:true});
  }

  if(i.commandName==="offduty"){
    const data=duty[m.id];
    if(!data.on) return i.reply({content:"Bạn chưa onduty",ephemeral:true});

    const end=Date.now();
    const min=Math.floor((end-data.start)/60000);

    if(m.roles.cache.has(ROLE_TT))
      data.ttMinutes+=min;

    data.on=false;
    save();

    sendEmbed(m,"off",new Date(data.start),new Date(end),min);
    checkPromote(m);

    i.reply({content:"Đã offduty",ephemeral:true});
  }

  if(i.commandName==="resetduty"){
    if(!m.roles.cache.has(ROLE_RESET))
      return i.reply({content:"Không có quyền",ephemeral:true});

    const target=i.options.getMember("user");
    duty[target.id]={on:false,start:0,lastChange:0,plate:"",ttMinutes:0};
    save();

    i.reply({content:"Đã reset",ephemeral:true});
  }
});

// ===== PRESENCE OFF =====
client.on("presenceUpdate",(oldP,newP)=>{
  const m=newP.member;
  if(!m) return;
  ensure(m.id);
  const d=duty[m.id];
  const now=Date.now();

  if(isGTA(newP)) d.lastChange=now;

  if(!isGTA(newP) && d.on){
    const end=now;
    const min=Math.floor((end-d.start)/60000);
    if(m.roles.cache.has(ROLE_TT)) d.ttMinutes+=min;
    d.on=false;
    save();
    sendEmbed(m,"off",new Date(d.start),new Date(end),min);
    checkPromote(m);
  }
});

// ===== AFK =====
setInterval(async ()=>{
  const now=Date.now();
  const g=client.guilds.cache.first();

  for(const id in duty){
    const d=duty[id];
    if(!d.on) continue;
    if(now-d.lastChange<10*60000) continue;

    const m=await g.members.fetch(id).catch(()=>null);
    if(!m) continue;

    const end=now;
    const min=Math.floor((end-d.start)/60000);
    if(m.roles.cache.has(ROLE_TT)) d.ttMinutes+=min;
    d.on=false;
    save();
    sendEmbed(m,"off",new Date(d.start),new Date(end),min);
    checkPromote(m);
  }
},60000);

client.login(TOKEN);
