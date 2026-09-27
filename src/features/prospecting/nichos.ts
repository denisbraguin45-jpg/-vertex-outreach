// ─── Catálogo de nichos de prospecção ────────────────────────────────────────
// Cada nicho define: tags OSM específicas + fallback por nome (regex) e
// keywords para Google Places (opcional). Sem qualificação comercial aqui.

export interface Nicho {
  id: string;
  label: string;
  osmTags: string[];
  nameRegex?: string;
  placesKeywords: string[];
}

export const NICHOS: Nicho[] = [
  {
    id: "concessionarias",
    label: "Concessionárias",
    osmTags: ["shop=car", "shop=car_repair", "shop=truck", "shop=motorcycle"],
    nameRegex: "concessionaria|motors|veiculos|automoveis|multimarcas",
    placesKeywords: ["concessionária de veículos", "loja de carros"],
  },
  {
    id: "clinicas",
    label: "Clínicas",
    osmTags: ["amenity=clinic", "amenity=dentist", "healthcare=clinic", "healthcare=dentist", "healthcare=physiotherapist"],
    nameRegex: "clinica|odonto|fisioterapia|estetica",
    placesKeywords: ["clínica médica", "clínica odontológica", "clínica de estética"],
  },
  {
    id: "academias",
    label: "Academias",
    osmTags: ["leisure=fitness_centre", "leisure=sports_centre"],
    nameRegex: "academia|crossfit|pilates|functional",
    placesKeywords: ["academia", "crossfit", "estúdio de pilates"],
  },
  {
    id: "restaurantes",
    label: "Restaurantes",
    osmTags: ["amenity=restaurant", "amenity=fast_food", "amenity=cafe", "amenity=bar"],
    nameRegex: "restaurante|pizzaria|lanchonete|hamburgueria|churrascaria",
    placesKeywords: ["restaurante", "pizzaria", "hamburgueria"],
  },
  {
    id: "imobiliarias",
    label: "Imobiliárias",
    osmTags: ["office=estate_agent"],
    nameRegex: "imobiliaria|imoveis|real estate",
    placesKeywords: ["imobiliária", "corretor de imóveis"],
  },
  {
    id: "advocacia",
    label: "Advocacia",
    osmTags: ["office=lawyer"],
    nameRegex: "advocacia|advogado|associados|sociedade de advogados",
    placesKeywords: ["escritório de advocacia", "advogado"],
  },
  {
    id: "petshops",
    label: "Pet Shops",
    osmTags: ["shop=pet", "shop=pet_grooming", "amenity=veterinary"],
    nameRegex: "pet shop|petshop|veterinaria",
    placesKeywords: ["pet shop", "clínica veterinária"],
  },
  {
    id: "saloes",
    label: "Salões e Barbearias",
    osmTags: ["shop=hairdresser", "shop=beauty", "shop=massage"],
    nameRegex: "salao|barbearia|studio de beleza|espaco beleza",
    placesKeywords: ["salão de beleza", "barbearia"],
  },
  {
    id: "escritorios",
    label: "Escritórios e Serviços B2B",
    osmTags: ["office=company", "office=it", "office=advertising_agency", "office=insurance", "office=accountant"],
    nameRegex: "consultoria|assessoria|contabilidade|agencia",
    placesKeywords: ["escritório de consultoria", "agência de marketing", "contabilidade"],
  },
  {
    id: "lojas",
    label: "Lojas (varejo)",
    osmTags: ["shop=clothes", "shop=shoes", "shop=furniture", "shop=electronics", "shop=jewelry", "shop=sports", "shop=bicycle"],
    nameRegex: "loja|boutique|magazine",
    placesKeywords: ["loja de roupas", "loja de móveis", "loja de eletrônicos"],
  },
  {
    id: "escolas",
    label: "Escolas e Cursos",
    osmTags: ["amenity=school", "amenity=college", "amenity=driving_school", "office=educational_institution"],
    nameRegex: "escola|instituto|curso|centro educacional",
    placesKeywords: ["escola particular", "curso livre", "centro de idiomas"],
  },
  {
    id: "outros",
    label: "Outros (busca ampla)",
    osmTags: ["shop", "office=company"],
    nameRegex: "ltda|eireli|me |mei |comercio|servicos",
    placesKeywords: ["empresa"],
  },
];

export function getNicho(id: string): Nicho | undefined {
  return NICHOS.find((n) => n.id === id);
}
