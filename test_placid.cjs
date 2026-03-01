const dotenv = require('dotenv');
dotenv.config({ path: '/Users/geovanepanini/Dev/FlowOS/.env.local' });

async function test() {
    const k = process.env.RENDER_API_KEY || process.env.PLACID_API_KEY;
    console.log("Has Key:", !!k);
    const renderPayload = {
        template_uuid: "25460c3c9ea5459b449490d884c560eabb2d111b2ff0b2fa5150c4c43073b9b8",
        layers: {
            "headline_news": { text: "Irã anuncia líder supremo" },
            "news-image": { image: "https://images.unsplash.com/photo-1504711434969-e33886168f5c" }
        },
        webhook_success: "https://example.com"
    };

    const renderRes = await fetch("https://api.placid.app/api/rest/images", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${k}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: JSON.stringify(renderPayload)
    });

    console.log("Status:", renderRes.status);
    const txt = await renderRes.text();
    console.log("Body:", txt);
}
test();
