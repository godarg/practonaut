/** Credentials are never project authority. This cache is scoped by the browser to a tab and origin. */
export const TAB_SESSION_KEY = 'practonaut.tab-session';
export interface TabSession {
  schema: 'practonaut.tab-session/2'; token: string; authorToken?:string;sessionId:string;
  language: 'en' | 'de'; theme: 'light' | 'dark' | 'system';
  workspace: 'board' | 'editor' | 'author';
}
type Access = () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const browserStorage: Access = () => sessionStorage;
export function clearTabSession(access: Access = browserStorage): void {
  try { access().removeItem(TAB_SESSION_KEY); } catch { /* Storage can be denied. */ }
}
export function readTabSession(access: Access = browserStorage): TabSession | undefined {
  try {
    const raw = access().getItem(TAB_SESSION_KEY);
    if (!raw) return undefined;
    if (raw.length > 1024) { clearTabSession(access); return undefined; }
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') { clearTabSession(access); return undefined; }
    const v = value as Record<string, unknown>;
    const keys=Object.keys(v).sort().join(',');
    if (!(keys==='language,schema,sessionId,theme,token,workspace'||keys==='authorToken,language,schema,sessionId,theme,token,workspace') || v.schema !== 'practonaut.tab-session/2'
      || typeof v.token !== 'string' || !/^[a-f0-9]{64}$/.test(v.token)
      || (Object.hasOwn(v,'authorToken')&&(typeof v.authorToken!=='string'||!/^[a-f0-9]{64}$/.test(v.authorToken)||v.authorToken===v.token))
      || typeof v.sessionId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.sessionId)
      || !(v.language === 'en' || v.language === 'de') || !(v.theme === 'light' || v.theme === 'dark' || v.theme === 'system')
      || !(v.workspace === 'board' || v.workspace === 'editor' || v.workspace === 'author')) { clearTabSession(access); return undefined; }
    return v as unknown as TabSession;
  } catch { clearTabSession(access); return undefined; }
}
/** Refused storage never prevents the initial, explicitly authorised in-memory session. */
export function writeTabSession(value: TabSession, access: Access = browserStorage): boolean {
  try { access().setItem(TAB_SESSION_KEY, JSON.stringify(value)); return true; } catch { return false; }
}
