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

const DEV_ROLE_ID = "1475815959616032883";
const INTERN_ROLE_ID = "1467725396433834149";

const DUTY_CHANNEL_ID = "1472440293940002828";
const WEEK_CHANNEL_ID = "1482542973848649838";


// ===== KEEP ALIVE =====

const PORT = process.env.PORT || 3000;

http.createServer((req,res)=>res.end("OK")).listen(PORT);

setInterval(()=>{
if(process.env.RENDER_EXTERNAL_URL){
https.get(process.env.RENDER_EXTERNAL_URL);
}
},300000);


// ===== CLIENT =====

const client = new Client({
intents:[
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMembers,
GatewayIntentBits.GuildPresences
]
});


// ===== DATABASE =====

const DB_FILE="./data.json";
let db={};

function loadDB(){
if(fs.existsSync(DB_FILE)){
db=JSON.parse(fs.readFileSync(DB_FILE));
}
}

function saveDB(){
fs.writeFileSync(DB_FILE,JSON.stringify(db,null,2));
}

loadDB();


// ===== TIME =====

function nowVN(){
return new Date(
new Date().toLocaleString("en-US",{timeZone:"Asia/Ho_Chi_Minh"})
);
}

function dateKeyVN(date=nowVN()){
return date.toLocaleDateString("vi-VN");
}

function formatTime(ms){
return new Date(ms).toLocaleTimeString("vi-VN",{
hour12:false,
timeZone:"Asia/Ho_Chi_Minh"
});
}

function diffText(ms){
const m=Math.floor(ms/60000);
return `${Math.floor(m/60)} giờ ${m%60} phút`;
}


// ===== USER =====

function getUser(id){
if(!db[id]) db[id]={total:0,days:{}};
return db[id];
}


// ===== FIND OPEN SESSION =====

function findOpenSession(user){
for(const [dayKey,day] of Object.entries(user.days||{})){
const session=day.sessions?.find(s=>!s.end);
if(session) return {dayKey,day,session};
}
return null;
}


// ===== EMBED =====

function buildEmbed(member,user,dayKey,status){

const day=user.days[dayKey];
if(!day) return null;

let timeline="";
let totalDay=0;

const now=Date.now();

day.sessions.forEach(s=>{
const end=s.end||now;

timeline+=`${formatTime(s.start)} ➝ ${s.end?formatTime(s.end):"..."}\n`;

totalDay+=end-s.start;
});

if(day.extra) totalDay+=day.extra;

const isIntern=member.roles.cache.has(INTERN_ROLE_ID);

return new EmbedBuilder()

.setColor(status.includes("Off")?"#ff4d4f":"#00ff9c")

.setAuthor({name:"BẢNG ONDUTY"})

.setDescription(
`**Tên Nhân Sự :** ${member}

**Biển Số :** ${day.plate||"Chưa nhập"}

**Thời Gian Onduty :**
${timeline||"Chưa có"}

**Ngày Onduty :** ${dayKey}

**Tổng Thời Gian Onduty :** ${diffText(totalDay)}
${isIntern?`\n**Tổng Thực Tập :** ${diffText(user.total)}`:""}

**Trạng Thái :** ${status}`
);
}


// ===== SEND / UPDATE EMBED =====

async function sendOrUpdateEmbed(channel,member,user,dayKey,status){

const day=user.days[dayKey];
const embed=buildEmbed(member,user,dayKey,status);

if(!embed) return;

if(day.messageId && day.channelId){

try{

const ch=await client.channels.fetch(day.channelId);
const msg=await ch.messages.fetch(day.messageId);

if(msg){
await msg.edit({embeds:[embed]});
return;
}

}catch{
day.messageId=null;
}

}

const msg=await channel.send({embeds:[embed]});

day.messageId=msg.id;
day.channelId=channel.id;

saveDB();
}


// ===== COMMANDS =====

const commands=[

new SlashCommandBuilder()
.setName("onduty")
.setDescription("Bắt đầu trực")
.addStringOption(o=>o.setName("bienso").setDescription("Biển số").setRequired(true)),

new SlashCommandBuilder()
.setName("offduty")
.setDescription("Kết thúc trực"),

new SlashCommandBuilder()
.setName("thaybienso")
.setDescription("Đổi biển số")
.addStringOption(o=>o.setName("bienso").setDescription("Biển số mới").setRequired(true)),

new SlashCommandBuilder()
.setName("penalty")
.setDescription("Cộng thời gian")
.addUserOption(o=>o.setName("user").setDescription("User").setRequired(true))
.addIntegerOption(o=>o.setName("minutes").setDescription("Phút").setRequired(true))
.addStringOption(o=>o.setName("type").setDescription("Loại").setRequired(true)
.addChoices(
{name:"Onduty ngày",value:"day"},
{name:"Thực tập tổng",value:"total"}
)),

new SlashCommandBuilder()
.setName("adjust")
.setDescription("Trừ thời gian")
.addUserOption(o=>o.setName("user").setDescription("User").setRequired(true))
.addIntegerOption(o=>o.setName("minutes").setDescription("Phút").setRequired(true))
.addStringOption(o=>o.setName("type").setDescription("Loại").setRequired(true)
.addChoices(
{name:"Onduty ngày",value:"day"},
{name:"Thực tập tổng",value:"total"}
)),

new SlashCommandBuilder()
.setName("forceoff")
.setDescription("Cưỡng chế offduty")
.addUserOption(o=>o.setName("user").setDescription("User").setRequired(true)),

new SlashCommandBuilder()
.setName("week")
.setDescription("Xem chấm công tuần")
.addUserOption(o=>o.setName("user").setDescription("Nhân sự").setRequired(true))

].map(c=>c.toJSON());


// ===== READY =====

client.once("ready",async()=>{

const rest=new REST({version:"10"}).setToken(TOKEN);

await rest.put(
Routes.applicationGuildCommands(client.user.id,GUILD_ID),
{body:commands}
);

console.log("BOT READY");

});

// ===== AUTO OFF WHEN LEAVE GAME  =====

client.on("presenceUpdate", async (oldPresence, newPresence) => {

try{

if(!newPresence) return;

const member = newPresence.member;
if(!member) return;

// lấy user trong DB
const user = getUser(member.id);

// tìm session đang trực
const open = findOpenSession(user);

if(!open) return;

// lấy activity discord
const activities = newPresence.activities ?? [];

// kiểm tra xem còn đang chơi server không
const playingServer = activities.some(a =>
a.name && a.name.toLowerCase().includes("gta5vn")
);

// nếu KHÔNG còn activity GTA5VN => offduty
if(!playingServer){

// đợi 10s kiểm tra lại
await new Promise(r => setTimeout(r,10000));

const memberCheck = await member.fetch();
const activities = memberCheck.presence?.activities ?? [];

const stillPlaying = activities.some(a =>
a.name && a.name.toLowerCase().includes("gta5vn")
);

if(stillPlaying) return;

open.session.end = Date.now();

user.total += open.session.end - open.session.start;

saveDB();

// update embed
const ch = await client.channels.fetch(open.day.channelId || DUTY_CHANNEL_ID);

await sendOrUpdateEmbed(
ch,
member,
user,
open.dayKey,
"Thoát Game (Alt Lấy Lợi Thế)"
);

console.log(`${member.user.tag} Đã Offduty (Alt Lấy Lợi Thế)`);

}

}catch(err){
console.log("Presence Error:", err);
}

});


// ===== COMMAND HANDLER =====

client.on("interactionCreate",async i=>{

try{

if(!i.isChatInputCommand()) return;

const member=await i.guild.members.fetch(i.user.id);
const user=getUser(member.id);
const dayKey=dateKeyVN();


// ===== WEEK =====

if(i.commandName==="week"){

await i.deferReply();

if(i.channel.id!==WEEK_CHANNEL_ID)
return i.reply({content:"❌ Chỉ dùng ở kênh chấm công",ephemeral:true});

const targetUser=i.options.getUser("user");
const memberTarget=await i.guild.members.fetch(targetUser.id);
const data=getUser(targetUser.id);

const monday = nowVN();
const day = monday.getDay() || 7;
monday.setDate(monday.getDate() - day + 1);
monday.setHours(0,0,0,0);;

let result="";

for(let d=0;d<7;d++){

const date = new Date(monday);
date.setDate(monday.getDate() + d);
date.setHours(0,0,0,0);

const key=dateKeyVN(date);
const dayData=data.days[key];

let total=0;

if(dayData){
dayData.sessions.forEach(s=>{
const end=s.end||Date.now();
total+=end-s.start;
});

if(dayData.extra) total+=dayData.extra;
}

const icon=total>=10800000?"🟢":"🔴";

const weekday=[
"Thứ 2","Thứ 3","Thứ 4","Thứ 5","Thứ 6","Thứ 7","Chủ Nhật"
][d];

result+=`${icon} **${weekday} (${key})** — ${diffText(total)}\n`;

}

const embed=new EmbedBuilder()
.setColor("#0099ff")
.setTitle("BẢNG CHẤM CÔNG TUẦN")
.setDescription(`**Nhân sự:** ${memberTarget}\n\n${result}`);

return i.editReply({embeds:[embed]});
}


// ===== ADMIN COMMANDS =====

if(i.commandName==="penalty"){

if(!member.roles.cache.has(DEV_ROLE_ID))
return i.reply({content:"❌ Muốn vượt quyền?",ephemeral:true});

const u=i.options.getUser("user");
const minutes=i.options.getInteger("minutes");
const type=i.options.getString("type");

const target=getUser(u.id);
const ms=minutes*60000;
const today=dateKeyVN();

if(type==="total") target.total+=ms;

if(type==="day"){

if(!target.days[today]){
target.days[today]={plate:"",sessions:[],messageId:null,channelId:null,extra:0};
}

target.days[today].extra=(target.days[today].extra||0)+ms;
}

saveDB();

const m=await i.guild.members.fetch(u.id);

await sendOrUpdateEmbed(i.channel,m,target,today,"Penalty");

return i.reply(`🟢 ${member} đã cộng ${minutes} phút cho ${u}`);
}


if(i.commandName==="adjust"){

if(!member.roles.cache.has(DEV_ROLE_ID))
return i.reply({content:"❌ Mày đéo đủ trình",ephemeral:true});

const u=i.options.getUser("user");
const minutes=i.options.getInteger("minutes");
const type=i.options.getString("type");

const target=getUser(u.id);
const ms=minutes*60000;
const today=dateKeyVN();

if(type==="total")
target.total=Math.max(0,target.total-ms);

if(type==="day" && target.days[today]){
target.days[today].extra=Math.max(0,(target.days[today].extra||0)-ms);
}

saveDB();

const m=await i.guild.members.fetch(u.id);

await sendOrUpdateEmbed(i.channel,m,target,today,"Adjust");

return i.reply(`🟠 ${member} đã trừ ${minutes} phút của ${u}`);
}


if(i.commandName==="forceoff"){

if(!member.roles.cache.has(DEV_ROLE_ID))
return i.reply({content:"❌ Có trình không?",ephemeral:true});

const u=i.options.getUser("user");
const target=getUser(u.id);

const today=dateKeyVN();
const day=target.days[today];

if(!day)
return i.reply("User chưa onduty");

const last=day.sessions.find(s=>!s.end);

if(!last)
return i.reply("User đã off");

last.end=Date.now();

target.total+=last.end-last.start;

saveDB();

const m=await i.guild.members.fetch(u.id);

await sendOrUpdateEmbed(i.channel,m,target,today,"Force Off");

return i.reply(`🔴 Đã cưỡng chế offduty ${u}`);
}


// ===== ONDUTY =====

if(i.commandName==="onduty"){

if(findOpenSession(user))
return i.reply({content:"❌ Mày đang onduty rồi",ephemeral:true});

const activities = member.presence?.activities ?? [];
const playing=activities.some(a=>a.name?.toLowerCase().includes("gta"));

if(!playing)
return i.reply({content:"❌ Mày chưa vào game!",ephemeral:true});

let day=user.days[dayKey];

if(!day){
day=user.days[dayKey]={plate:"",sessions:[],messageId:null,channelId:null,extra:0};
}

const plate=i.options.getString("bienso");

day.plate=plate;

day.sessions.push({
start:Date.now(),
end:null
});

saveDB();

await sendOrUpdateEmbed(i.channel,member,user,dayKey,"Đang trực");

return i.reply({content:"Onduty thành công",ephemeral:true});
}

// ===== THAY BIEN SO =====

if(i.commandName==="thaybienso"){

const open=findOpenSession(user);

if(!open)
return i.reply({content:"❌ Mày chưa onduty",ephemeral:true});

const plate=i.options.getString("bienso");

open.day.plate=plate;

saveDB();

await sendOrUpdateEmbed(i.channel,member,user,open.dayKey,"Đang trực");

return i.reply({
content:`🟢 Đã đổi biển số thành **${plate}**`,
ephemeral:true
});
}

// ===== OFFDUTY =====

if(i.commandName==="offduty"){

const open=findOpenSession(user);

if(!open)
return i.reply({content:"Mày chưa onduty",ephemeral:true});

open.session.end=Date.now();

user.total+=open.session.end-open.session.start;

saveDB();

await sendOrUpdateEmbed(i.channel,member,user,open.dayKey,"Off");

return i.reply({content:"Đã offduty",ephemeral:true});
}

}catch(err){

console.error(err);

if(i.deferred||i.replied)
await i.editReply("❌ Lỗi bot");
else
await i.reply({content:"❌ Lỗi bot",ephemeral:true});

}

});

client.login(TOKEN);
