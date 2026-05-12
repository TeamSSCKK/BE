export function getKstIsoString(date: Date | string): string {
  const d = new Date(date);
  // 한국 표준시(KST)는 UTC보다 9시간 빠름
  const kstOffset = 9 * 60;
  d.setMinutes(d.getMinutes() + kstOffset);
  
  const iso = d.toISOString();
  return iso.replace("Z", "+09:00");
}