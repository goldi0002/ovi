// The answers here are repeated in the FAQPage structured data in index.html, so keep the two in
// step: answer engines are told only what the page actually says. The home page shows them (HomePage.tsx).
export const FAQ_ITEMS = [
  {
    q: "Do I need an account to shorten a link?",
    a: "No. Paste any URL on the home page and press Shorten URL. Links made without an account get a random code and expire after 30 days.",
  },
  {
    q: "How long do links last?",
    a: "30 days for links made without an account. After signing in you can set your own expiry date, or leave it empty to keep the link for good.",
  },
  {
    q: "Can I choose my own short code?",
    a: "Yes, once you sign in with Google or GitHub. Codes are 3 to 32 letters, digits, hyphens or underscores.",
  },
  {
    q: "Can I shorten many links at once?",
    a: "Yes, once you sign in. Choose Many links, paste up to 25 URLs, one per line, and shorten them in one go. To choose a custom code or expiry for each link, upload a CSV with the columns url, code and expires_at. If any line is wrong, nothing is shortened and each bad line is listed so you can fix it. You can copy all the new links at once or download them as a CSV file.",
  },
  {
    q: "What do the click stats show?",
    a: "Clicks per day for the last 7, 30 or 90 days, the site each click came from, and the device and browser used. Only the time, the referring site, the device and the browser are stored — never IP addresses or full user agents.",
  },
  {
    q: "Is Ovi open source?",
    a: "Yes. Ovi is free software under the AGPL-3.0 licence. Its source code is at github.com/goldi0002/ovi, and anyone can run their own copy.",
  },
];
