import { Link, useLocation } from "react-router-dom";
import { Plus, BarChart3, TestTube2, Tags } from "lucide-react";
import { cn } from "@/lib/utils";

interface AdminLayoutProps {
  children: React.ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const location = useLocation();

  const navItems = [
    { path: "/admin/add-tools", label: "Добавление инструментов", icon: Plus },
    { path: "/admin/test-model", label: "Тестирование модели", icon: TestTube2 },
    { path: "/admin/analytics", label: "Аналитика", icon: BarChart3 },
    { path: "/admin/reannotation", label: "Доразметка", icon: Tags },
  ];

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-lg font-semibold">Система распознавания</h1>
          <p className="text-xs text-muted-foreground">Административная панель</p>
        </div>
        
        <nav className="flex-1 p-3">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded text-sm mb-1",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                )}
              >
                <item.icon className="w-4 h-4" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
};

export default AdminLayout;

