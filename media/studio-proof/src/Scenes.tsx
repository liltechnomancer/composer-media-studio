import React from 'react';
import {AbsoluteFill, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Video} from '@remotion/media';

const ink = '#f4f0e8';
const orange = '#ff6a18';
const fade = (f:number) => interpolate(f,[0,14],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
export const Opening: React.FC = () => {const f=useCurrentFrame(); return <AbsoluteFill style={{backgroundColor:'#17191c',color:ink,fontFamily:'Studio',padding:'76px 88px',justifyContent:'center'}}>
  <div style={{position:'absolute',right:75,top:58,width:430,height:604,overflow:'hidden',borderRadius:12,opacity:.9}}><Video src={staticFile('ldraw-mountain-hailuo-original.mp4')} muted style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>
  <div style={{opacity:fade(f),width:630,zIndex:1}}><div style={{fontSize:23,letterSpacing:3,color:orange,fontWeight:700}}>MEDIA STUDIO</div><div style={{fontSize:78,lineHeight:1.02,fontWeight:700,marginTop:20}}>From artwork<br/>to motion.</div><div style={{fontSize:28,lineHeight:1.35,color:'#d3cec4',marginTop:28,maxWidth:570}}>A real path through public artwork, an LDraw project and a Studio-generated clip.</div></div>
  <div style={{position:'absolute',left:88,bottom:55,color:'#bcb8af',fontSize:18}}>FOOTAGE: PUBLIC PAGES · LOCAL PREVIEW · GENERATED MOTION</div>
</AbsoluteFill>;};

export const Recorded: React.FC<{file:string; start:number; title:string; subtitle:string}> = ({file,start,title,subtitle}) => { const f=useCurrentFrame(); return <AbsoluteFill style={{backgroundColor:'#17191c',fontFamily:'Studio',color:ink}}>
  <div style={{position:'absolute',left:60,top:36,width:1160,height:572,borderRadius:10,overflow:'hidden',backgroundColor:'#0d0e10'}}><Video src={staticFile(file)} trimBefore={start} muted style={{width:'100%',height:'100%',objectFit:'contain'}}/></div>
  <div style={{position:'absolute',left:64,right:64,bottom:34,display:'flex',justifyContent:'space-between',alignItems:'end',opacity:fade(f)}}><div><div style={{fontSize:30,fontWeight:700}}>{title}</div><div style={{fontSize:20,color:'#cbc7bf',marginTop:5}}>{subtitle}</div></div><div style={{fontSize:17,letterSpacing:1,color:orange,fontWeight:700}}>MEDIA STUDIO</div></div>
</AbsoluteFill>;};

export const Motion: React.FC = () => {const f=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:'#17191c',fontFamily:'Studio',color:ink}}>
  <div style={{position:'absolute',left:125,top:35,width:480,height:650,overflow:'hidden',borderRadius:10}}><Video src={staticFile('ldraw-mountain-hailuo-original.mp4')} muted style={{width:'100%',height:'100%',objectFit:'contain'}}/></div>
  <div style={{position:'absolute',left:665,top:205,width:500,opacity:fade(f)}}><div style={{fontSize:22,letterSpacing:2,color:orange,fontWeight:700}}>GENERATED MOTION</div><div style={{fontSize:54,lineHeight:1.04,fontWeight:700,marginTop:18}}>Move the mountain.</div><div style={{fontSize:25,lineHeight:1.35,color:'#d3cec4',marginTop:24}}>A Studio image-to-video study made with Hailuo 2.3, from Woodhouse Share artwork NEW-074.</div></div>
</AbsoluteFill>;};
export const Closing: React.FC = () => {const f=useCurrentFrame();return <AbsoluteFill style={{backgroundColor:'#f4f0e8',fontFamily:'Studio',color:'#17191c',justifyContent:'center',alignItems:'center',textAlign:'center',opacity:fade(f)}}><div style={{fontSize:24,letterSpacing:3,color:'#b93e00',fontWeight:700}}>MEDIA STUDIO</div><div style={{fontSize:68,fontWeight:700,marginTop:20}}>Make. Keep. Share.</div><div style={{fontSize:27,color:'#555861',marginTop:20}}>media.loftwah.com</div><div style={{fontSize:19,color:'#555861',marginTop:56}}>Public gallery footage · LDraw local preview · Studio-generated motion</div></AbsoluteFill>;};
