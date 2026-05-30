create table if not exists public.employee (
    id bigserial primary key,
    surname varchar(255),
    name varchar(255),
    patronymic varchar(255)
);

create table if not exists public.processing_jobs (
    id bigserial primary key,
    status varchar(255),
    create_date timestamp,
    last_modified timestamp
);

create table if not exists public.minio_file (
    id bigserial primary key,
    package_id bigint,
    created_at timestamp,
    bucket_name varchar(255),
    file_path varchar(255),
    file_name varchar(255),
    constraint fk_package_id foreign key (package_id) references processing_jobs(id),
    unique(bucket_name, file_path)
);


create table if not exists public.tool (
    id serial primary key,
    tool_name varchar(255) unique
);


create table if not exists public.employee_order (
    id UUID primary key,
    description VARCHAR(255),
    employee_id bigint,
    created_at timestamp,
    last_modified timestamp,
    constraint fk_employee_id foreign key (employee_id) references employee(id)
);

create table if not exists public.accounting (
    id bigserial primary key,
    job_id bigint,
    action_type varchar(255),
    order_id UUID,
    create_date timestamp,
    constraint fk_accounting_job_id foreign key (job_id) references processing_jobs(id) on delete cascade,
    constraint fk_order_id foreign key (order_id) references employee_order(id)
);

create table if not exists public.tool_order_item (
    id bigserial primary key,
    order_id UUID,
    tool_id int,
    marking varchar(255),
    constraint fk_item_order_id foreign key (order_id) references employee_order(id) on delete cascade,
    constraint fk_item_tool_id foreign key (tool_id) references tool(id)
);

create table if not exists public.classification_result(
       id bigserial primary key,
       job_id bigint,
       tool_id int,
       file_id bigint,
       original_file_id bigint,
       marking varchar(255),
       confidence double precision,
       created_at timestamp,
       constraint fk_job_id foreign key (job_id) references processing_jobs(id) on delete cascade,
       constraint fk_tool_id foreign key (tool_id) references tool(id),
       constraint fk_classification_minio_file foreign key (file_id) references minio_file(id) on delete cascade,
       constraint fk_original_minio_file foreign key (original_file_id) references minio_file(id) on delete cascade

);



