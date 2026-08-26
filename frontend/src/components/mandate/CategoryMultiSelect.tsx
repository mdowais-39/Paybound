import React, { useState, useRef, useEffect } from "react";
import {
  Check,
  ChevronDown,
  X,
  Search,
  CheckCheck,
  RotateCcw,
  Sparkles,
  ShoppingBag,
  Tag,
} from "lucide-react";

interface CategoryMultiSelectProps {
  availableCategories: string[];
  selectedCategories: string[];
  onChange: (categories: string[]) => void;
  id?: string;
}

// Curated list of standard catalog categories with metadata for nice display
const ALL_CATALOG_CATEGORIES: { id: string; name: string; group?: string }[] = [
  { id: "footwear", name: "Footwear", group: "Apparel & Gear" },
  { id: "running shoes", name: "Running Shoes", group: "Apparel & Gear" },
  { id: "sports apparel", name: "Sports Apparel", group: "Apparel & Gear" },
  { id: "backpacks", name: "Backpacks & Bags", group: "Apparel & Gear" },
  { id: "electronics", name: "Electronics", group: "Tech & Work" },
  { id: "headphones", name: "Headphones & Audio", group: "Tech & Work" },
  { id: "office chair", name: "Office Furniture / Chairs", group: "Tech & Work" },
  { id: "smart accessories", name: "Smart Accessories", group: "Tech & Work" },
  { id: "fitness trackers", name: "Fitness Trackers", group: "Lifestyle & Home" },
  { id: "kitchen appliances", name: "Kitchen Appliances", group: "Lifestyle & Home" },
  { id: "stationery", name: "Stationery & Supplies", group: "Lifestyle & Home" },
  { id: "books & media", name: "Books & Media", group: "Lifestyle & Home" },
];

export const CategoryMultiSelect: React.FC<CategoryMultiSelectProps> = ({
  availableCategories = [],
  selectedCategories,
  onChange,
  id,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Combine static catalog categories with any dynamic categories passed from server
  const mergedCategories = React.useMemo(() => {
    const set = new Set<string>();
    const list: { id: string; name: string; group?: string }[] = [];

    // Add curated items first
    ALL_CATALOG_CATEGORIES.forEach((c) => {
      set.add(c.id.toLowerCase());
      list.push(c);
    });

    // Add any extra available categories not already present
    availableCategories.forEach((cat) => {
      const lower = cat.toLowerCase();
      if (!set.has(lower)) {
        set.add(lower);
        list.push({
          id: lower,
          name: cat.charAt(0).toUpperCase() + cat.slice(1),
          group: "Other Catalog",
        });
      }
    });

    return list;
  }, [availableCategories]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleCategory = (categoryId: string) => {
    const lower = categoryId.toLowerCase();
    if (selectedCategories.includes(lower)) {
      if (selectedCategories.length > 1) {
        onChange(selectedCategories.filter((c) => c !== lower));
      }
    } else {
      onChange([...selectedCategories, lower]);
    }
  };

  const handleSelectAll = () => {
    const all = mergedCategories.map((c) => c.id);
    onChange(all);
  };

  const handleClearAll = () => {
    if (mergedCategories.length > 0) {
      // Keep at least one default
      onChange([mergedCategories[0].id]);
    }
  };

  // Filter categories by search
  const filteredCategories = mergedCategories.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (c.group && c.group.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div id={id || "mandate-category-select"} className="flex flex-col gap-2 relative">
      {/* Label and Count */}
      <div className="flex items-center justify-between">
        <label className="font-mono text-xs uppercase tracking-wider text-[#6B7280] font-semibold flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-[#6B7280]" />
          <span>Allowed Categories</span>
        </label>
        <span className="font-mono text-[11px] text-[#6B7280]">
          {selectedCategories.length} of {mergedCategories.length} permitted
        </span>
      </div>

      {/* Selected Tags Chips Display + Dropdown Trigger */}
      <div className="flex flex-wrap items-center gap-1.5 p-2 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl min-h-[46px]">
        {selectedCategories.map((catId) => {
          const matched = mergedCategories.find((c) => c.id === catId);
          const displayName = matched ? matched.name : catId;
          return (
            <span
              key={catId}
              className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-[#111827] bg-white border border-[#D1D5DB] px-3 py-1 rounded-full shadow-2xs group transition-all"
            >
              <span>{displayName}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCategory(catId);
                }}
                disabled={selectedCategories.length <= 1}
                className="text-[#9CA3AF] hover:text-[#EF4444] disabled:opacity-30 disabled:hover:text-[#9CA3AF] transition-colors cursor-pointer"
                title={
                  selectedCategories.length <= 1
                    ? "At least one category is required"
                    : `Remove ${displayName}`
                }
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          );
        })}

        {/* Dropdown Button */}
        <div ref={dropdownRef} className="relative inline-block">
          <button
            type="button"
            id="btn-open-category-dropdown"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-mono text-xs font-semibold transition-all cursor-pointer shadow-2xs ${
              isOpen
                ? "bg-[#111827] text-white"
                : "bg-white hover:bg-[#F3F4F6] text-[#111827] border border-[#D1D5DB] hover:border-[#9CA3AF]"
            }`}
          >
            <span>+ Add Category</span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isOpen ? "rotate-180 text-white" : "text-[#6B7280]"
              }`}
            />
          </button>

          {/* Floating Dropdown Menu */}
          {isOpen && (
            <div
              id="dropdown-category-picker"
              className="absolute left-0 top-full mt-2 w-72 sm:w-80 bg-white border border-[#E5E7EB] rounded-2xl shadow-xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150 ring-1 ring-black/5"
            >
              {/* Search Bar inside dropdown */}
              <div className="relative mb-2.5">
                <Search className="w-3.5 h-3.5 text-[#9CA3AF] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search categories..."
                  className="w-full pl-8 pr-3 py-1.5 bg-[#F9FAFB] border border-[#E5E7EB] focus:bg-white focus:border-[#111827] rounded-lg text-xs text-[#111827] outline-none placeholder:text-[#9CA3AF] font-mono transition-all"
                />
              </div>

              {/* Quick Actions (Select All / Reset) */}
              <div className="flex items-center justify-between px-1 pb-2 mb-1.5 border-b border-[#F3F4F6] text-[11px] font-mono">
                <button
                  type="button"
                  onClick={handleSelectAll}
                  className="text-[#2563EB] hover:text-[#1D4ED8] font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <CheckCheck className="w-3 h-3" />
                  <span>Select All</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-[#6B7280] hover:text-[#111827] flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Default</span>
                </button>
              </div>

              {/* Categories Scrollable List */}
              <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                {filteredCategories.length === 0 ? (
                  <div className="text-center py-4 font-mono text-xs text-[#9CA3AF]">
                    No categories matching "{searchQuery}"
                  </div>
                ) : (
                  filteredCategories.map((cat) => {
                    const isSelected = selectedCategories.includes(cat.id);
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => toggleCategory(cat.id)}
                        className={`w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between text-xs transition-all cursor-pointer group ${
                          isSelected
                            ? "bg-[#F3F4F6] text-[#111827] font-semibold"
                            : "hover:bg-[#F9FAFB] text-[#4B5563]"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-4 h-4 rounded-md border flex items-center justify-center transition-all ${
                              isSelected
                                ? "bg-[#111827] border-[#111827] text-white"
                                : "border-[#D1D5DB] group-hover:border-[#9CA3AF] bg-white"
                            }`}
                          >
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                          <span>{cat.name}</span>
                        </div>

                        {cat.group && (
                          <span className="font-mono text-[10px] text-[#9CA3AF]">
                            {cat.group}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
