const axios = require('axios');
require('dotenv').config();

async function getPromoOpcionProducts() {
    const response = await axios.post(
        'https://promocionalesenlinea.net/api/all-products',
        JSON.stringify({
            user: process.env.USER_PO,
            password: process.env.PASSWORD_PO,
        }), {
            headers: {
                'Content-Type': 'application/json',
            }
        }
    );

    return response.data;
}

async function getVariantInventory(sku) {
    const response = await axios.post(
        'https://promocionalesenlinea.net/api/all-stocks',
        JSON.stringify({
            user: process.env.USER_PO,
            password: process.env.PASSWORD_PO,
            sku,
        }), {
            headers: {
                'Content-Type': 'application/json',
            }
        }
    );

    return response.data;
}

function productHasSize(variants) {
    return variants.some(variant => variant.talla !== null);
}

async function getProductByHandle(handle) {
    const response = await axios.post(
        'https://gi-hh-global.myshopify.com/admin/api/2024-07/graphql.json',
        JSON.stringify({
            query: `
                query {
                    productByHandle(handle: "${handle}") {
                        title
                        variants(first: 250) {
                            nodes {
                                title
                                inventoryQuantity
                                inventoryItem {
                                    id
                                }
                            }
                        }
                    }
                }
            `,
        }), {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            }
        }
    );

    return response.data.data.productByHandle;
}

async function updateInventory(input) {
    //Usa esta mutation porque Shopify no permite actualizar inventario por productVariantsBulkUpdate
    const response = await axios.post(
        'https://gi-hh-global.myshopify.com/admin/api/2024-07/graphql.json',
        JSON.stringify({
            query: `
                mutation InventorySet($input: InventorySetQuantitiesInput!) {
                    inventorySetQuantities(input: $input) {
                        inventoryAdjustmentGroup {
                            changes {
                                delta
                                name
                            }
                        }
                        userErrors {
                            message
                            field
                        }
                    }
                }
            `,
            variables: {
                input,
            }
        }), {
            headers: {
                'Content-Type': 'application/json',
                'X-Shopify-Access-Token': process.env.SHOPIFY_TOKEN,
            }
        }
    );

    return response.data.data.inventorySetQuantities.inventoryAdjustmentGroup;
}

async function updateProducts() {
    const responseProducts = await getPromoOpcionProducts();

    if (!responseProducts.success) return;

    const products = responseProducts.response;
    for (const product of products) {
        try {
            // if (product.skuPadre !== 'Z 1090') continue;
            const activeVariants = product.hijos.filter(variant => variant.estatus === '1');
            if (activeVariants.length === 0) continue; // Salta productos sin variantes activas

            const hasSize = productHasSize(activeVariants);
            const handle = `${product.nombrePadre} ${product.skuPadre}`.trim().toLowerCase().replace(/\s+/g, '-').replace(/-+$/g, '');
            const shopifyProduct = await getProductByHandle(handle);
            console.log(`Producto encontrado por el handle: ${shopifyProduct.title}`);

            const shopifyVariants = shopifyProduct.variants.nodes;
            for (const activeVariant of activeVariants) {
                const variantTitle = hasSize ? `${activeVariant.color} / ${activeVariant.talla}` : activeVariant.color;
                const variant = shopifyVariants.find(v => v.title === variantTitle);
                
                const responseInventory = await getVariantInventory(activeVariant.skuHijo);
                const variantInventory = responseInventory.Stocks.reduce((acum, item) => acum + item.Stock, 0);
                console.log('Variante encontrada:', variant.title, ` Inventario: Prev ${variant.inventoryQuantity} Now ${variantInventory}`);

                if (variant.inventoryQuantity !== variantInventory) { //Actualiza la variante si el inventario ha cambiado
                    const variantToUpdate = {
                        quantities: {
                            inventoryItemId: variant.inventoryItem.id, //Usa id de inventario porque usar id de variante o producto no funciona
                            locationId: 'gid://shopify/Location/69743050958',
                            quantity: variantInventory,
                        },
                        name: "available",
                        reason: "correction",
                        ignoreCompareQuantity: true, //Desactiva la comparación de inventario para siempre sobreescribir con la info del proveedor
                    };
                    const response = await updateInventory(variantToUpdate);
                    console.log('Inventario actualizado:', response.changes);
                }
            }
            // break;
        } catch (error) {
            console.error(`Error procesando el producto ${product.nombrePadre} ${product.skuPadre}:`, error);
        }
    }
}

updateProducts();