async function debugScrape() {
    const url = 'https://agenciabrasil.ebc.com.br/economia/noticia/2026-03/vorcaro-e-tranferido-de-guarulhos-para-presidio-no-interior-de-sp';
    console.log("Fetching: ", url);
    try {
        const res = await fetch(url, { headers: { "User-Agent": "FlowOS/1.0" } });
        console.log("Status: ", res.status);
        const text = await res.text();
        console.log("Body length: ", text.length);
        const ogImage = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
        console.log("OG Image Match: ", ogImage);
    } catch (e) {
        console.error("Error: ", e);
    }
}

debugScrape();
