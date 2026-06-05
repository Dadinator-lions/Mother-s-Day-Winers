// Parse YYYY-MM-DD without timezone shift, format as "Month D, YYYY".
window.fmtDate = function (iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
};
