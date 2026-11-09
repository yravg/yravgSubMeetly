import puppeteer from 'puppeteer';import fs from 'fs';
const b=await puppeteer.launch({executablePath:process.env.PUPPETEER_EXECUTABLE_PATH,headless:'new'});const p=await b.newPage();
const d='data:image/png;base64,'+fs.readFileSync('shots/b-minutes-owner.png').toString('base64');
const r=await p.evaluate(async(d,pts)=>{const i=new Image();i.src=d;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return {w:i.width,h:i.height,v:pts.map(([n,a,b])=>[n,'#'+[...x.getImageData(a,b,1,1).data].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('')])}},d,JSON.parse(process.argv[2]));
console.log(JSON.stringify(r));await b.close();
