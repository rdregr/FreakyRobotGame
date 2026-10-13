import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.0';
const $=id=>document.getElementById(id);const msg=s=>$('authMessage').textContent=s;
let supabase,session=null,profile=null;
const renderProfile=p=>{if(!p)return;profile=p;$('name').value=p.username;$('name').readOnly=true;$('name').dispatchEvent(new Event('input'));$('pilotDisplay').textContent=p.username.toUpperCase();$('profileSummary').textContent=p.username+' · LEVEL '+p.level;const kd=p.deaths?(p.kills/p.deaths).toFixed(2):p.kills.toFixed(2);const values=[['KILLS',p.kills],['DEATHS',p.deaths],['K/D',kd],['WINS',p.wins],['LOSSES',p.losses],['MATCHES',p.matches_played],['XP',p.xp],['LEVEL',p.level],['OPERATOR',p.favorite_operator]];$('profileStats').replaceChildren();for(const [k,v] of values){const d=document.createElement('div');d.textContent=k+': '+v;$('profileStats').append(d)}};
const socket=window.frgSocket;
socket.on('auth_status',data=>{if(data.ok){renderProfile(data.profile);$('accountGate').classList.add('hidden');msg('');}else{$('accountGate').classList.remove('hidden');msg(data.message||'Sign in required')}});
socket.on('profile_data',renderProfile);
socket.on('connect',()=>{if(session?.access_token)socket.emit('auth_session',{token:session.access_token})});
async function boot(){try{const config=await fetch('/api/auth-config').then(r=>r.json());if(!config.url||!config.anonKey){msg('Account service not configured yet. Set the Supabase environment variables on Render.');return}supabase=createClient(config.url,config.anonKey,{auth:{autoRefreshToken:true,persistSession:true,detectSessionInUrl:true}});
 supabase.auth.onAuthStateChange((_event,newSession)=>{session=newSession;if(newSession?.access_token){socket.emit('auth_session',{token:newSession.access_token})}else{$('accountGate').classList.remove('hidden');profile=null}});
 const {data}=await supabase.auth.getSession();session=data.session;if(session?.access_token)socket.emit('auth_session',{token:session.access_token});
 }catch(e){msg('Unable to start login: '+e.message)}}
$('authSignIn').onclick=async()=>{if(!supabase)return;msg('Signing in...');const {error}=await supabase.auth.signInWithPassword({email:$('authEmail').value.trim(),password:$('authPassword').value});if(error)msg(error.message)};
$('authSignUp').onclick=async()=>{if(!supabase)return;const username=$('authUsername').value.trim();if(!/^[A-Za-z0-9_]{3,18}$/.test(username)){msg('Username must be 3–18 letters, numbers, or underscores.');return}if($('authPassword').value.length<8){msg('Use a password of at least 8 characters.');return}msg('Creating account...');const {data,error}=await supabase.auth.signUp({email:$('authEmail').value.trim(),password:$('authPassword').value,options:{data:{username},emailRedirectTo:location.origin}});msg(error?error.message:'Check your email for a verification link, then sign in.');};
$('authReset').onclick=async()=>{if(!supabase)return;const email=$('authEmail').value.trim();if(!email){msg('Enter your email first.');return}const {error}=await supabase.auth.resetPasswordForEmail(email,{redirectTo:location.origin});msg(error?error.message:'If this email has an account, a reset email will be sent.');};
$('profileOpen').onclick=()=>{if(profile){$('profileDrawer').classList.add('open');socket.emit('profile_refresh')}else $('accountGate').classList.remove('hidden')};
$('profileClose').onclick=()=>$('profileDrawer').classList.remove('open');
$('profileSignOut').onclick=async()=>{if(!supabase)return;socket.emit('logout_game');await supabase.auth.signOut();$('profileDrawer').classList.remove('open');$('accountGate').classList.remove('hidden');location.reload()};
boot();
