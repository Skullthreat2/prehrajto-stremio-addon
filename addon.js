const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://prehrajto.cz';
// "Vizitka" našeho doplňku, která se tváří jako prohlížeč
const BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
};

const manifest = {
    id: 'com.community.prehrajto-cz',
    version: '1.0.9', // Finální verze s maskováním
    name: 'Přehraj.to',
    description: 'Poskytuje streamy a vyhledávání z webu přehrajto.cz. Inspirováno Kodi doplňkem od Saros72.',
    resources: ['stream', 'catalog'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [
        {
            type: 'movie',
            id: 'prehrajto-search',
            name: 'Přehraj.to Hledání',
            extra: [{ name: 'search', isRequired: true }]
        }
    ]
};

const builder = new addonBuilder(manifest);

// Funkce pro získání streamu
builder.defineStreamHandler(async (args) => {
    if (!args.id) { return { streams: [] }; }
    console.log(`Požadavek na stream pro: ${args.type} ${args.id}`);

    try {
        // Tento dotaz jde na API, nepotřebuje maskování
        const metaResponse = await axios.get(`https://v3-cinemeta.strem.io/meta/${args.type}/${args.id}.json`);
        const movieName = metaResponse.data.meta.name;
        console.log(`Podle ID zjištěn název filmu: "${movieName}"`);

        const searchUrl = `${BASE_URL}/hledej/${encodeURIComponent(movieName)}`;
        console.log(`Hledám na: ${searchUrl}`);

        // Přidáváme hlavičky, aby nás web pustil dál
        const searchResponse = await axios.get(searchUrl, { headers: BROWSER_HEADERS });
        const $search = cheerio.load(searchResponse.data);

        let moviePageUrl;
        $search('div.video__picture--container').each((i, el) => {
            const title = $search(el).find('h3.video__title').text().trim();
            if (title.toLowerCase().includes(movieName.toLowerCase())) {
                moviePageUrl = $search(el).find('a.video--link').attr('href');
                return false; 
            }
        });
        
        if (!moviePageUrl) {
            console.log(`Film obsahující "${movieName}" nenalezen na prehrajto.cz`);
            return { streams: [] };
        }
        
        if (moviePageUrl && !moviePageUrl.startsWith('http')) {
            moviePageUrl = BASE_URL + moviePageUrl;
        }

        console.log(`Nalezen odkaz na film (plná URL): ${moviePageUrl}`);

        // Přidáváme hlavičky i sem
        const moviePageResponse = await axios.get(moviePageUrl, { headers: BROWSER_HEADERS });
        const pageHtml = moviePageResponse.data;
        const match = pageHtml.match(/file:\s*"([^"]+)"/);

        if (match && match[1]) {
            const videoUrl = match[1];
            console.log(`Nalezen přímý stream: ${videoUrl}`);
            const stream = {
                url: videoUrl,
                title: `Přehraj.to - Hotovo!`,
                behaviorHints: {
                    proxyHeaders: { "User-Agent": BROWSER_HEADERS["User-Agent"], "Referer": moviePageUrl }
                }
            };
            return { streams: [stream] };
        } else {
            console.log('Přímý odkaz na video nenalezen ve zdrojovém kódu stránky.');
            return { streams: [] };
        }

    } catch (error) {
        console.error("Chyba při získávání streamu:", error.message);
        return { streams: [] };
    }
});

// Funkce pro vyhledávání
builder.defineCatalogHandler(async (args) => {
    const searchQuery = args.extra.search;
    if (!searchQuery) return { metas: [] };

    console.log(`Požadavek na katalog s vyhledáváním: "${searchQuery}"`);
    const searchUrl = `${BASE_URL}/hledej/${encodeURIComponent(searchQuery)}`;

    try {
        // Přidáváme hlavičky i sem
        const response = await axios.get(searchUrl, { headers: BROWSER_HEADERS });
        const $ = cheerio.load(response.data);

        const metas = [];
        $('div.video__picture--container').each((index, element) => {
            const linkElement = $(element).find('a.video--link');
            const imgElement = $(element).find('img.thumb1');
            const title = linkElement.attr('title'); 
            const href = linkElement.attr('href');
            let poster = imgElement.attr('src');
            if (poster && !poster.startsWith('http')) poster = BASE_URL + poster;
            if (title && href) {
                const filmIdMatch = href.match(/-(tt\d+)/);
                const id = filmIdMatch ? filmIdMatch[1] : `ph:${title.replace(/\s/g, '_')}`;
                metas.push({
                    id: id, type: 'movie', name: title, poster: poster, posterShape: 'poster'
                });
            }
        });

        console.log(`Nalezeno ${metas.length} výsledků.`);
        return { metas: metas };

    } catch (error) {
        console.error("Chyba při vyhledávání:", error.message);
        return { metas: [] };
    }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Doplněk běží na http://127.0.0.1:${PORT}`);
