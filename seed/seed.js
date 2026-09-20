require("dotenv").config();
const mongoose = require("mongoose");
const { Product } = require("../models/models");
const { buildProductImageUrls } = require("../utils/utils");

const products = [
    { name: "Margherita Pizza", price: 249, qty: 25 },
    { name: "Farmhouse Pizza", price: 299, qty: 18 },
    { name: "Veg Burger", price: 99, qty: 40 },
    { name: "Chicken Burger", price: 149, qty: 30 },
    { name: "Paneer Tikka Roll", price: 129, qty: 20 },
    { name: "Chicken Shawarma Roll", price: 159, qty: 15 },
    { name: "French Fries", price: 89, qty: 50 },
    { name: "Peri Peri Fries", price: 109, qty: 12 },
    { name: "Veg Manchurian", price: 179, qty: 10 },
    { name: "Chicken Fried Rice", price: 189, qty: 8 },
    { name: "Cold Coffee", price: 79, qty: 35 },
    { name: "Masala Lemonade", price: 59, qty: 45 },
    { name: "Chocolate Brownie", price: 99, qty: 5 },
    { name: "Gulab Jamun (2 pc)", price: 69, qty: 3 },
    { name: "Cheese Garlic Bread", price: 119, qty: 0 },
    { name: "Veg Momos (8 pc)", price: 129, qty: 0 },
    { name: "Chicken Momos (8 pc)", price: 159, qty: 22 }
];

async function seed() {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        await Product.deleteMany({});

        // Image URLs are derived from the product name and the Cloudinary settings in
        // .env, so pointing at a different media account only means editing .env.
        const withStock = products.map((p) => ({
            ...p,
            instock: p.qty > 0,
            image_urls: buildProductImageUrls(p.name)
        }));

        await Product.insertMany(withStock);

        const withImages = withStock.filter((p) => p.image_urls.length > 0).length;

        console.log(`Seeded ${withStock.length} products (${withImages} with image URLs)`);

        if (withImages === 0) {
            console.log("CLOUDINARY_CLOUD_NAME is not set — products were seeded without images.");
        }

        await mongoose.disconnect();
    } catch (err) {
        console.error("Seed failed:", err);
        process.exit(1);
    }
}

seed();
