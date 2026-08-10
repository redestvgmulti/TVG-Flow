async function debugScrape() {
    const url = 'https://www.maisgoias.com.br/cidades/pf-prende-em-goias-suspeitos-de-promover-imigracao-ilegal-de-brasileiros-para-os-eua/';
    console.log("Fetching: ", url);
    try {
        const res = await fetch(url, { headers: { "User-Agent": "FlowOS/1.0" } });
        console.log("Status: ", res.status);
        const text = await res.text();
        console.log("Body length: ", text.length);
        const ogImage = text.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
        console.log("OG Image Match: ", ogImage);

        if (!ogImage) {
            // Try loose search
            const looseMatch = text.match(/og:image/i);
            console.log("Includes 'og:image': ", !!looseMatch);
            // Look for any image tags as fallback
            const firstImg = text.match(/<img[^>]*src=["']([^"']+)["']/i)?.[1];
            console.log("First Img tag: ", firstImg);
        }
    } catch (e) {
        console.error("Error: ", e);
    }
}

debugScrape();
