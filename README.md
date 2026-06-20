# VOGUE·AI — Virtual Fashion Advisor

A complete, production-grade AI-powered fashion advisor web application.

## Features

### Pages & Features
- **Home Dashboard** — Trending fashion grid with category filtering (Women's, Seasonal, Accessories, Footwear etc)
- **Fashion News** — Categorised articles (Trends, Styling Tips, Celebrity) with filtering
- **User Profile** — Personal dashboard with stats, navigation, and all user data
- **Mood Board** — Pinterest-style image upload board (drag & drop or file picker)
- **Style Quiz** — 7-step intelligent personalization quiz, to determine your body type, undertone, style for the occasion
- **Swipe Style**- Swipe through more than 14k+ style options for 6 different types of occasions curated for your body type
- **Style Analytics** -Analyzes your styles, like and dislikes from style quiz
- **AI Results** — Gemini-powered outfit recommendations, colour palette, do's/don'ts
- **Save/Bookmark** — Heart any outfit to save it to your collection
- **Dark Mode** — Full dark theme with localStorage persistence

---

## Setup & API Integration

### 1. Gemini AI API

Replace `YOUR_GEMINI_API_KEY` in `index.html` with your actual key:

```javascript
const GEMINI_API_KEY = 'YOUR_GEMINI_API_KEY';
```

Get a free API key at: https://makersuite.google.com/app/apikey

The app sends the quiz answers to Gemini Pro and parses structured JSON back, including:
- Body type inference
- Outfit recommendations
- Colour palette by undertone
- Do's & Don'ts
- Occasion appropriateness score

**Fallback**: If the API key is not set, the app uses smart mock results based on quiz logic — so the app always works, even without an API key.

### 2. News API (Optional)

To fetch real news articles, replace `YOUR_NEWS_API_KEY`:

```javascript
const NEWS_API_KEY = 'YOUR_NEWS_API_KEY';
```

Get a free key at: https://newsapi.org

The app currently uses curated static articles as a built-in fallback — no News API key is required to run.

**Note:** NewsAPI free tier restricts browser-side requests. For production, route News API calls through a backend proxy:

```javascript
// Backend route (Node.js/Express example):
app.get('/api/news', async (req, res) => {
  const response = await fetch(
    `https://newsapi.org/v2/everything?q=fashion&apiKey=${NEWS_API_KEY}`
  );
  const data = await response.json();
  res.json(data);
});
```

---
## To start/ run 
```javascript
npm install
node server.js
```
Add your credentials of your database created in postgresSQL to save signup/login information

## Quiz Logic

The quiz does NOT ask for body type directly. Instead it collects:

| Input | Used For |
|-------|----------|
| Height + Weight | BMI reference |
| Shoulder width | Top/body balance |
| Waist type | Fit recommendations |
| Hip proportion | Lower body styling |
| Skin undertone | Colour palette |
| Occasion | Outfit category |
| Time of day | Fabric & colour depth |
| Comfort level | Style range |
| Style preference | Overall aesthetic |

The AI infers body type from proportions and generates tailored advice.

---

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (zero dependencies, zero build)
- **Fonts**: Playfair Display (display) + DM Sans (body) via Google Fonts
- **AI**: Google Gemini Pro API
- **News**: NewsAPI.org
- **Storage**: localStorage(theme, saved items, mood board, quiz results), PostgresSQL(signup/login)

---

## Screenshots:

<img width="1898" height="858" alt="image" src="https://github.com/user-attachments/assets/96fdc8fe-9015-4aab-b64a-177653f9a712" />
<img width="1911" height="867" alt="image" src="https://github.com/user-attachments/assets/e41152ec-c31e-4277-8361-b51e0fe06623" />
<img width="1748" height="739" alt="image" src="https://github.com/user-attachments/assets/a31f3820-1fe3-4d20-b348-23b2b41d700c" />
<img width="1846" height="854" alt="image" src="https://github.com/user-attachments/assets/f8eac765-a005-46c9-9968-4ff021e476d1" />
<img width="1878" height="857" alt="image" src="https://github.com/user-attachments/assets/395d4460-ca51-48db-ba72-0fe7a4fb1e4f" />




## License

MIT — free to use and modify.
