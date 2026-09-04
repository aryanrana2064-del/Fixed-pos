"""Business templates for VYRO VX7 — defaults only, never restrictions."""

UNITS = ["Piece", "Pair", "Box", "Pack", "Dozen", "Kg", "Gram", "Litre", "Meter", "Bottle", "Set", "Other"]

BUSINESS_TYPES = [
    "General Retail", "Jewellery", "Garments & Fashion", "Footwear", "Grocery",
    "Electronics & Mobile", "Cosmetics", "Hardware", "Stationery & Books",
    "Gift & Lifestyle", "Other",
]

# field: {key, label, type} — all optional, shown under "Advanced Details"
TEMPLATES = {
    "General Retail": {
        "categories": {"General": ["Items", "Accessories"], "Offers": ["Combo", "Clearance"]},
        "customFields": [],
        "defaultUnit": "Piece",
        "defaultTax": 5,
        "attributes": ["Size", "Color"],
    },
    "Jewellery": {
        "categories": {
            "Jewellery": ["Rings", "Earrings", "Chains", "Necklaces", "Bracelets", "Bangles", "Accessories"],
            "Boxes": ["Ring Box", "Earring Box", "Necklace Box", "Bangle Box", "Pendant Box", "Custom Box"],
        },
        "customFields": [
            {"key": "purity", "label": "Purity", "type": "text"},
            {"key": "grossWeight", "label": "Gross Weight (g)", "type": "number"},
            {"key": "netWeight", "label": "Net Weight (g)", "type": "number"},
            {"key": "makingCharges", "label": "Making Charges", "type": "number"},
            {"key": "stoneDetails", "label": "Stone Details", "type": "text"},
            {"key": "huid", "label": "HUID", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 3,
        "attributes": ["Material", "Size"],
    },
    "Garments & Fashion": {
        "categories": {"Men": ["Shirts", "T-Shirts", "Trousers", "Jeans"], "Women": ["Kurtis", "Sarees", "Tops", "Dresses"], "Kids": ["Sets", "Tops", "Bottoms"]},
        "customFields": [
            {"key": "size", "label": "Size", "type": "text"},
            {"key": "color", "label": "Color", "type": "text"},
            {"key": "fabric", "label": "Fabric", "type": "text"},
            {"key": "style", "label": "Style", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 5,
        "attributes": ["Size", "Color", "Material"],
    },
    "Footwear": {
        "categories": {"Men": ["Formal", "Casual", "Sports", "Sandals"], "Women": ["Heels", "Flats", "Sports", "Sandals"], "Kids": ["School", "Casual"]},
        "customFields": [
            {"key": "size", "label": "Size (UK)", "type": "text"},
            {"key": "color", "label": "Color", "type": "text"},
            {"key": "material", "label": "Material", "type": "text"},
        ],
        "defaultUnit": "Pair",
        "defaultTax": 5,
        "attributes": ["Size", "Color"],
    },
    "Grocery": {
        "categories": {"Staples": ["Rice", "Atta", "Dal", "Oil"], "Packaged": ["Snacks", "Beverages", "Biscuits"], "Dairy": ["Milk", "Curd", "Paneer"], "Household": ["Cleaning", "Personal Care"]},
        "customFields": [
            {"key": "batch", "label": "Batch No", "type": "text"},
            {"key": "expiry", "label": "Expiry Date", "type": "date"},
            {"key": "packSize", "label": "Pack Size", "type": "text"},
        ],
        "defaultUnit": "Kg",
        "defaultTax": 5,
        "attributes": ["Pack Size"],
    },
    "Electronics & Mobile": {
        "categories": {"Mobiles": ["Smartphones", "Feature Phones"], "Accessories": ["Chargers", "Cases", "Earphones", "Cables"], "Appliances": ["Audio", "Wearables", "Others"]},
        "customFields": [
            {"key": "model", "label": "Model", "type": "text"},
            {"key": "imei", "label": "IMEI", "type": "text"},
            {"key": "serial", "label": "Serial Number", "type": "text"},
            {"key": "warranty", "label": "Warranty", "type": "text"},
            {"key": "storage", "label": "Storage", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 18,
        "attributes": ["Model", "Storage", "Color"],
    },
    "Cosmetics": {
        "categories": {"Makeup": ["Lips", "Eyes", "Face"], "Skincare": ["Cream", "Serum", "Cleanser"], "Haircare": ["Shampoo", "Oil", "Color"]},
        "customFields": [
            {"key": "shade", "label": "Shade", "type": "text"},
            {"key": "batch", "label": "Batch No", "type": "text"},
            {"key": "expiry", "label": "Expiry Date", "type": "date"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 18,
        "attributes": ["Shade", "Size"],
    },
    "Hardware": {
        "categories": {"Tools": ["Hand Tools", "Power Tools"], "Fittings": ["Plumbing", "Electrical", "Fasteners"], "Paints": ["Interior", "Exterior", "Primer"]},
        "customFields": [
            {"key": "material", "label": "Material", "type": "text"},
            {"key": "size", "label": "Size / Gauge", "type": "text"},
            {"key": "brandModel", "label": "Model", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 18,
        "attributes": ["Size", "Material"],
    },
    "Stationery & Books": {
        "categories": {"Stationery": ["Pens", "Notebooks", "Files", "Art"], "Books": ["School", "Competitive", "General"], "Office": ["Printing", "Supplies"]},
        "customFields": [
            {"key": "author", "label": "Author / Publisher", "type": "text"},
            {"key": "isbn", "label": "ISBN", "type": "text"},
            {"key": "edition", "label": "Edition", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 12,
        "attributes": ["Size"],
    },
    "Gift & Lifestyle": {
        "categories": {"Gifts": ["Soft Toys", "Showpieces", "Cards"], "Packaging": ["Boxes", "Bags", "Wrap"], "Home": ["Decor", "Utility"]},
        "customFields": [
            {"key": "occasion", "label": "Occasion", "type": "text"},
            {"key": "material", "label": "Material", "type": "text"},
        ],
        "defaultUnit": "Piece",
        "defaultTax": 18,
        "attributes": ["Color", "Size"],
    },
    "Other": {
        "categories": {"General": ["Items"]},
        "customFields": [{"key": "note1", "label": "Extra Detail 1", "type": "text"}, {"key": "note2", "label": "Extra Detail 2", "type": "text"}],
        "defaultUnit": "Piece",
        "defaultTax": 5,
        "attributes": ["Variant"],
    },
}


def template_for(business_type: str) -> dict:
    return TEMPLATES.get(business_type or "General Retail", TEMPLATES["General Retail"])
